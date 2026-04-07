/**
 * Orchestrator — multi-agent state machine for Sprint 38/39.
 *
 * Iterates pre-computed execution levels, injects role-specific system prompts
 * and upstream context, executes workers, extracts sentinel context from
 * architect results, and handles failures with transitive skipping and live
 * re-planning (Sprint 39).
 */

import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { SubtaskJob, OrchestratorLevelResult } from './types.js';
import { isDeltaResponse } from './types.js';
import { ROLE_PROMPTS, ARCHITECT_CONTEXT_JSON_SENTINEL } from './role-prompts.js';
import { parseArchitectContext, type ArchitectContext } from './architect-context.js';
import { buildLevels } from './spec-compiler.js';
import { schemaGate } from '../core/schema-gate.js';
import type { RunLogger } from '../core/run-logger.js';
import type { Provider } from '../providers/types.js';
import type { Config } from '../core/config.js';

/** Max bytes per upstream context file injection. Matches FAILURE_CONTEXT_MAX_BYTES in parallel-executor.ts */
const CONTEXT_MAX_BYTES = 4096;
/** Max bytes for the total systemPromptPrefix across all injected upstream chunks. */
const SYSTEM_PROMPT_MAX_BYTES = 16384;
/** Max chars for remaining jobs in re-plan prompt before truncation kicks in. */
const REPLAN_REMAINING_MAX_CHARS = 8000;
/** Number of jobs shown in truncated re-plan prompt when full JSON exceeds REPLAN_REMAINING_MAX_CHARS. */
const REPLAN_REMAINING_SHOWN_JOBS = 5;
/** Number of schema-gate retries for re-plan LLM response validation. */
const REPLAN_SCHEMA_GATE_RETRIES = 2;

/** Truncate text to at most maxBytes UTF-8 bytes; appends '(truncated)' if cut. */
function truncateToBytes(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, 'utf8');
  if (buf.byteLength <= maxBytes) return text;
  return buf.slice(0, maxBytes).toString('utf8') + '\n(truncated)';
}

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface OrchestratorOptions {
  specHash: string;
  logger: RunLogger;
  // executeOrchestratorLevel is injected (testable)
  executeLevelFn: (jobs: SubtaskJob[]) => Promise<OrchestratorLevelResult[]>;
  // Provider and config for re-plan LLM calls (Sprint 39). Optional — when
  // absent, replanOnFailure() falls back to stub behavior (return remaining
  // unchanged, log orchestrator_replan_failed).
  provider?: Provider;
  config?: Config;
}

export interface OrchestratorResult {
  totalCompleted: number;
  totalFailed: number;
  totalSkipped: number;
  suspectCount: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Helper: consume a chatStream to a single text string (no tool calls)
// ---------------------------------------------------------------------------

async function chatOnce(
  provider: Provider,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  model: string | undefined,
): Promise<string> {
  let text = '';
  for await (const event of provider.chatStream(
    messages,
    [],
    model ? { model } : undefined,
  )) {
    if (event.type === 'text') text += event.content;
    else if (event.type === 'error') throw new Error(event.error);
    else if (event.type === 'done') break;
  }
  return text;
}

// ---------------------------------------------------------------------------
// Backward contamination DFS
// ---------------------------------------------------------------------------

/**
 * Walk backward from failedJob through the completedJobs graph.
 * Returns IDs of all completed ancestors whose outputs the failed job consumed.
 */
function computeSuspectIds(failedJob: SubtaskJob, completedJobs: SubtaskJob[]): string[] {
  const completedById = new Map(completedJobs.map(j => [j.id, j]));
  const suspect = new Set<string>();
  const visited = new Set<string>();
  const stack = [...failedJob.dependsOn];

  while (stack.length > 0) {
    const id = stack.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);

    const job = completedById.get(id);
    if (!job) continue;  // not a completed job — skip

    suspect.add(id);
    for (const dep of job.dependsOn) {
      if (!visited.has(dep)) stack.push(dep);
    }
  }

  return [...suspect];
}

// ---------------------------------------------------------------------------
// Re-plan prompt builder
// ---------------------------------------------------------------------------

function buildReplanPrompt(
  failedJob: SubtaskJob,
  error: string,
  remainingJobs: SubtaskJob[],
  completedJobs: SubtaskJob[],
  architectContext: ArchitectContext | null,
): string {
  const completedSection = completedJobs.length === 0
    ? '(none)'
    : completedJobs.map(j => `  - [${j.id}] ${j.title}: ${j.role}`).join('\n');

  const remainingJson = JSON.stringify(remainingJobs, null, 2);
  let remainingSection: string;
  if (remainingJson.length <= REPLAN_REMAINING_MAX_CHARS) {
    remainingSection = remainingJson;
  } else {
    const shown = remainingJobs.slice(0, REPLAN_REMAINING_SHOWN_JOBS).map(j => `[${j.id}] ${j.title} (${j.role})`).join('\n');
    const omitted = remainingJobs.length - REPLAN_REMAINING_SHOWN_JOBS;
    remainingSection = `${shown}\n...${omitted > 0 ? omitted : 0} more jobs omitted`;
  }

  const architectSection = architectContext
    ? JSON.stringify(architectContext, null, 2)
    : '(not available)';

  return `You are re-planning after a subtask failure in a multi-agent orchestrator.

COMPLETED SUBTASKS (${completedJobs.length} total — IDs you must NOT include in delta):
${completedSection}

FAILED SUBTASK:
  ID: ${failedJob.id}
  Role: ${failedJob.role}
  Prompt: ${failedJob.prompt.slice(0, 500)}
  Error: ${error}

ARCHITECT CONTEXT (if available):
${architectSection}

REMAINING SUBTASKS (${remainingJobs.length} total):
${remainingSection}

Return a JSON object with exactly one key "delta": an array of SubtaskJob objects.
Each item in delta is either a revised subtask (same id, updated fields) or a new subtask (new id).
Jobs not in delta are unchanged. Never include completed subtask IDs in delta.

Required fields per job: id (string), title (string), role (architect|implementer|tester|reviewer), prompt (string), dependsOn (string[]).

Example: {"delta":[{"id":"fix-schema","title":"Fix schema","role":"implementer","prompt":"...","dependsOn":[]}]}`;
}

// ---------------------------------------------------------------------------
// replanOnFailure — real LLM call (Sprint 39)
// ---------------------------------------------------------------------------

async function replanOnFailure(
  failedJob: SubtaskJob,
  error: string,
  remainingJobs: SubtaskJob[],
  completedJobs: SubtaskJob[],
  architectContext: ArchitectContext | null,
  logger: RunLogger,
  specHash: string,
  options: OrchestratorOptions,
): Promise<{ jobs: SubtaskJob[]; suspectIds: string[] }> {
  const { provider, config } = options;

  // Stub fallback: no provider configured
  if (!provider || !config) {
    logger.log({
      event: 'orchestrator_replan_failed',
      specHash,
      failedSubtaskId: failedJob.id,
      errorMessage: 'no provider configured for re-planning',
    });
    return { jobs: remainingJobs, suspectIds: [] };
  }

  const model = config.smart_model ?? config.model;
  if (!model) {
    logger.log({
      event: 'orchestrator_replan_failed',
      specHash,
      failedSubtaskId: failedJob.id,
      errorMessage: 'no model configured for re-planning',
    });
    return { jobs: remainingJobs, suspectIds: [] };
  }

  const basePrompt = buildReplanPrompt(failedJob, error, remainingJobs, completedJobs, architectContext);
  const completedIds = new Set(completedJobs.map(j => j.id));

  let retriesUsed = 0;

  try {
    const delta = await schemaGate(
      async (retryContext?: string) => {
        const userContent = retryContext
          ? `${basePrompt}\n\nPrevious response was invalid: ${retryContext}\nPlease fix and return only valid JSON.`
          : basePrompt;

        if (retryContext) retriesUsed++;

        return chatOnce(
          provider,
          [{ role: 'user', content: userContent }],
          model,
        );
      },
      isDeltaResponse,
      REPLAN_SCHEMA_GATE_RETRIES,
    );

    // Apply defaults and filter completed IDs from delta
    const mergedById = new Map(remainingJobs.map(j => [j.id, j]));
    let filteredCount = 0;

    for (const deltaJob of delta.delta) {
      if (completedIds.has(deltaJob.id)) {
        // Model included a completed job — silently filter, count for result event
        filteredCount++;
        continue;
      }

      // Apply defaults for optional fields the model may have omitted.
      // Object.assign lets defaults appear first without triggering TS2783.
      const merged: SubtaskJob = Object.assign(
        { files: [] as string[], criteria: [] as string[], systemPromptPrefix: '' },
        deltaJob,
      );

      mergedById.set(merged.id, merged);
    }

    const revisedJobs = [...mergedById.values()];

    // Backward contamination DFS
    const suspectIds = computeSuspectIds(failedJob, completedJobs);

    logger.log({
      event: 'orchestrator_replan_result',
      specHash,
      failedSubtaskId: failedJob.id,
      deltaCount: delta.delta.length - filteredCount,
      filteredCompletedCount: filteredCount,
      suspectCount: suspectIds.length,
      retriesUsed,
    });

    return { jobs: revisedJobs, suspectIds };
  } catch (e) {
    logger.log({
      event: 'orchestrator_replan_failed',
      specHash,
      failedSubtaskId: failedJob.id,
      errorMessage: e instanceof Error ? e.message : String(e),
    });
    return { jobs: remainingJobs, suspectIds: [] };
  }
}

// ---------------------------------------------------------------------------
// Compute transitively skipped jobs
// ---------------------------------------------------------------------------

/**
 * Compute transitively skipped jobs via DFS from the failed job.
 * Returns IDs of all jobs that should be skipped.
 */
export function computeSkippedIds(failedId: string, allJobs: SubtaskJob[]): string[] {
  const skipped = new Set<string>();
  const visited = new Set<string>([failedId]);  // cycle guard
  const stack = [failedId];
  while (stack.length > 0) {
    const currentId = stack.pop()!;
    for (const job of allJobs) {
      if (job.dependsOn.includes(currentId) && !skipped.has(job.id)) {
        skipped.add(job.id);
        if (!visited.has(job.id)) {
          visited.add(job.id);
          stack.push(job.id);
        }
      }
    }
  }
  return [...skipped];
}

// ---------------------------------------------------------------------------
// runOrchestrator
// ---------------------------------------------------------------------------

/**
 * Run the orchestrator: iterate pre-computed levels, inject context, execute workers,
 * extract sentinel context, handle failures with re-planning.
 */
export async function runOrchestrator(
  levels: SubtaskJob[][],
  allJobs: SubtaskJob[],
  options: OrchestratorOptions,
): Promise<OrchestratorResult> {
  const { specHash, logger, executeLevelFn } = options;
  const start = Date.now();

  // Job state map
  const jobStatus = new Map<string, JobStatus>();
  for (const job of allJobs) jobStatus.set(job.id, 'pending');

  // O(1) job lookup by ID
  const jobById = new Map<string, SubtaskJob>(allJobs.map(j => [j.id, j]));

  // Context files produced by completed architect jobs: id -> absolute path
  const contextFiles = new Map<string, string>();

  // Parsed ArchitectContext objects for re-plan use (separate from file-based injection)
  const architectContexts = new Map<string, ArchitectContext>();

  // Accumulator of completed SubtaskJobs (append-only, never mutated after add)
  const completedJobs: SubtaskJob[] = [];

  // Suspect job IDs accumulated across all re-plan calls
  const suspectJobIds = new Set<string>();

  const contextDir = mkdtempSync(join(tmpdir(), 'phase2s-context-'));

  // Mutable levels copy for mid-loop splice after re-leveling
  const mutableLevels = [...levels];

  logger.log({
    event: 'orchestrator_started',
    specHash,
    totalJobs: allJobs.length,
    levelCount: mutableLevels.length,
  });

  if (mutableLevels.length === 0 && allJobs.length > 0) {
    // Defensive: no levels produced but jobs exist — likely a buildDependencyGraph edge case
    logger.log({ event: 'goal_error', message: 'orchestrator received 0 levels for non-empty job list' });
  }

  try {
    for (let levelIdx = 0; levelIdx < mutableLevels.length; levelIdx++) {
      const levelJobs = mutableLevels[levelIdx];

      // Filter out skipped, failed, and already-completed jobs from this level
      const activeJobs = levelJobs.filter(job => {
        const s = jobStatus.get(job.id);
        return s !== 'skipped' && s !== 'failed' && s !== 'completed';
      });

      if (activeJobs.length === 0) {
        continue;
      }

      // Pre-level: inject upstream context into systemPromptPrefix
      for (const job of activeJobs) {
        let prefix = ROLE_PROMPTS[job.role] + '\n\n';

        for (const upstreamId of job.dependsOn) {
          const ctxFile = contextFiles.get(upstreamId);
          if (ctxFile) {
            try {
              const raw = readFileSync(ctxFile, 'utf8');
              const content = truncateToBytes(raw, CONTEXT_MAX_BYTES);
              const upstreamJob = jobById.get(upstreamId);
              prefix += `Prior context from upstream subtask '${upstreamJob?.title ?? upstreamId}':\n${content}\n\n`;
            } catch {
              // context file unreadable — skip
            }
          }
        }

        job.systemPromptPrefix = truncateToBytes(prefix, SYSTEM_PROMPT_MAX_BYTES);

        logger.log({
          event: 'job_routed',
          specHash,
          subtaskId: job.id,
          role: job.role,
          systemPromptLength: prefix.length,
        });

        logger.log({
          event: 'job_promoted',
          specHash,
          subtaskId: job.id,
          role: job.role,
          level: levelIdx,
        });
      }

      // Mark jobs as running
      for (const job of activeJobs) {
        jobStatus.set(job.id, 'running');
      }

      // Execute the level
      const results = await executeLevelFn(activeJobs);

      // Post-level: process results
      for (const result of results) {
        if (result.status === 'completed') {
          jobStatus.set(result.subtaskId, 'completed');

          const job = jobById.get(result.subtaskId);

          // Add to completedJobs accumulator (Sprint 39)
          if (job) completedJobs.push(job);

          // Sentinel extraction (architect only)
          if (job?.role === 'architect' && result.stdout) {
            // Parse typed ArchitectContext for re-plan use (Sprint 39)
            const ctx = parseArchitectContext(result.stdout);
            if (ctx) {
              architectContexts.set(result.subtaskId, ctx);
            }

            // Also write context file for downstream worker injection (existing mechanism)
            const sentinelIdx = result.stdout.indexOf(ARCHITECT_CONTEXT_JSON_SENTINEL);
            if (sentinelIdx !== -1) {
              const contentStart = sentinelIdx + ARCHITECT_CONTEXT_JSON_SENTINEL.length;
              const endIdx = result.stdout.indexOf('```', contentStart);
              const raw = endIdx !== -1
                ? result.stdout.slice(contentStart, endIdx).trim()
                : result.stdout.slice(contentStart).trim();

              const ctxPath = join(contextDir, `context-${job.id}.md`);
              try {
                writeFileSync(ctxPath, truncateToBytes(raw, CONTEXT_MAX_BYTES), 'utf8');
                result.contextFile = ctxPath;
                contextFiles.set(result.subtaskId, ctxPath);
              } catch {
                logger.log({
                  event: 'orchestrator_context_missing',
                  specHash,
                  subtaskId: result.subtaskId,
                  level: levelIdx,
                });
              }
            } else {
              logger.log({
                event: 'orchestrator_context_missing',
                specHash,
                subtaskId: result.subtaskId,
                level: levelIdx,
              });
            }
          }
        } else {
          // Failed job — DFS transitive skip then replanOnFailure
          jobStatus.set(result.subtaskId, 'failed');

          // Use jobById (not allJobs) so delta-added jobs are included in DFS and remaining
          const allKnownJobs = [...jobById.values()];

          const skippedIds = computeSkippedIds(result.subtaskId, allKnownJobs);
          for (const sid of skippedIds) {
            jobStatus.set(sid, 'skipped');
          }

          const job = jobById.get(result.subtaskId);
          if (!job) continue;  // defensive: result subtaskId unknown — skip

          const remainingPending = allKnownJobs.filter(j => jobStatus.get(j.id) === 'pending');

          // Get the most recent architect context for re-plan (prefer direct dependency)
          const architectContext = (() => {
            for (const depId of job.dependsOn) {
              const ctx = architectContexts.get(depId);
              if (ctx) return ctx;
            }
            // Fall back to any available architect context
            for (const [, ctx] of architectContexts) return ctx;
            return null;
          })();

          let replanResult: { jobs: SubtaskJob[]; suspectIds: string[] } = {
            jobs: remainingPending,
            suspectIds: [],
          };

          try {
            replanResult = await replanOnFailure(
              job,
              result.error ?? 'unknown error',
              remainingPending,
              completedJobs,
              architectContext,
              logger,
              specHash,
              options,
            );
          } catch {
            // replanOnFailure threw unexpectedly — use fallback
          }

          // Accumulate suspect IDs
          for (const id of replanResult.suspectIds) {
            suspectJobIds.add(id);
          }

          // Re-level the revised remaining jobs and splice into mutableLevels
          const revisedPending = replanResult.jobs;
          if (revisedPending.length > 0) {
            const newLevels = buildLevels(revisedPending);
            mutableLevels.splice(levelIdx + 1, mutableLevels.length, ...newLevels);

            // Update jobById with any new jobs from the delta
            for (const j of revisedPending) {
              jobById.set(j.id, j);
              if (!jobStatus.has(j.id)) {
                jobStatus.set(j.id, 'pending');
              }
            }
          }

          // Sync any jobs that were removed from the revised pending list (use jobById so
          // delta-added jobs from prior re-plans are included in the sweep)
          const pendingIds = new Set(revisedPending.map(j => j.id));
          for (const j of jobById.values()) {
            if (jobStatus.get(j.id) === 'pending' && !pendingIds.has(j.id)) {
              jobStatus.set(j.id, 'skipped');
            }
          }
        }
      }
    }
  } finally {
    try {
      rmSync(contextDir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }

  const totalCompleted = [...jobStatus.values()].filter(s => s === 'completed').length;
  const totalFailed = [...jobStatus.values()].filter(s => s === 'failed').length;
  const totalSkipped = [...jobStatus.values()].filter(s => s === 'skipped').length;
  const durationMs = Date.now() - start;

  logger.log({
    event: 'orchestrator_completed',
    specHash,
    totalCompleted,
    totalFailed,
    totalSkipped,
    suspectCount: suspectJobIds.size,
    durationMs,
  });

  return { totalCompleted, totalFailed, totalSkipped, suspectCount: suspectJobIds.size, durationMs };
}
