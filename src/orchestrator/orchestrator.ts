/**
 * Orchestrator — multi-agent state machine for Sprint 38.
 *
 * Iterates pre-computed execution levels, injects role-specific system prompts
 * and upstream context, executes workers, extracts sentinel context from
 * architect results, and handles failures with transitive skipping.
 */

import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { SubtaskJob, OrchestratorLevelResult } from './types.js';
import { ROLE_PROMPTS, ARCHITECT_CONTEXT_SENTINEL } from './role-prompts.js';
import type { RunLogger } from '../core/run-logger.js';

/** Max bytes per upstream context file injection. Matches FAILURE_CONTEXT_MAX_BYTES in parallel-executor.ts */
const CONTEXT_MAX_BYTES = 4096;
/** Sentinel string — single source of truth is ARCHITECT_CONTEXT_SENTINEL in role-prompts.ts */
const CONTEXT_SENTINEL = ARCHITECT_CONTEXT_SENTINEL;

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
}

export interface OrchestratorResult {
  totalCompleted: number;
  totalFailed: number;
  totalSkipped: number;
  durationMs: number;
}

/**
 * Failure re-plan stub. Sprint 38: logs event, returns jobs unchanged.
 * Sprint 39: call LLM with failure context + spec -> revised SubtaskJob[]
 */
async function replanOnFailure(
  failedJob: SubtaskJob,
  _error: string,  // Sprint 39: use for LLM failure context
  remainingJobs: SubtaskJob[],
  logger: RunLogger,
  specHash: string,
  skippedSubtaskIds: string[],
): Promise<SubtaskJob[]> {
  logger.log({
    event: 'orchestrator_replan',
    specHash,
    failedSubtaskId: failedJob.id,
    skippedSubtaskIds,
    remainingJobCount: remainingJobs.length,
  });
  return remainingJobs;
}

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

/**
 * Run the orchestrator: iterate pre-computed levels, inject context, execute workers,
 * extract sentinel context, handle failures.
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

  const contextDir = join(tmpdir(), `phase2s-context-${specHash}-${Date.now()}`);
  mkdirSync(contextDir, { recursive: true });

  logger.log({
    event: 'orchestrator_started',
    specHash,
    totalJobs: allJobs.length,
    levelCount: levels.length,
  });

  if (levels.length === 0 && allJobs.length > 0) {
    // Defensive: no levels produced but jobs exist — likely a buildDependencyGraph edge case
    logger.log({ event: 'goal_error', specHash, message: 'orchestrator received 0 levels for non-empty job list' } as never);
  }

  try {
    for (let levelIdx = 0; levelIdx < levels.length; levelIdx++) {
      const levelJobs = levels[levelIdx];

      // Filter out skipped jobs from this level
      const activeJobs = levelJobs.filter(job => jobStatus.get(job.id) !== 'skipped');

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

        job.systemPromptPrefix = prefix;

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

          // Sentinel extraction (architect only)
          const job = jobById.get(result.subtaskId);
          if (job?.role === 'architect' && result.stdout) {
            const sentinelIdx = result.stdout.indexOf(CONTEXT_SENTINEL);
            if (sentinelIdx !== -1) {
              const raw = result.stdout.slice(sentinelIdx + CONTEXT_SENTINEL.length).trim();
              const ctxPath = join(contextDir, `context-${result.subtaskId}.md`);
              try {
                writeFileSync(ctxPath, truncateToBytes(raw, CONTEXT_MAX_BYTES), 'utf8');
                result.contextFile = ctxPath;  // expose to caller via result object
                contextFiles.set(result.subtaskId, ctxPath);
              } catch {
                // disk write failed — log as context missing, continue processing other results
                logger.log({
                  event: 'orchestrator_context_missing',
                  specHash,
                  subtaskId: result.subtaskId,
                  level: levelIdx,
                });
              }
            } else {
              // Sentinel missing — log observable event
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

          const skippedIds = computeSkippedIds(result.subtaskId, allJobs);
          for (const sid of skippedIds) {
            jobStatus.set(sid, 'skipped');
          }

          const remainingPending = allJobs.filter(j => jobStatus.get(j.id) === 'pending');

          const job = jobById.get(result.subtaskId);
          if (!job) continue;  // defensive: result subtaskId unknown — skip

          // Wrap replanOnFailure — Sprint 39 LLM call can throw; don't lose completed counts
          let updated: SubtaskJob[] = remainingPending;
          try {
            updated = await replanOnFailure(
              job,
              result.error ?? 'unknown error',
              remainingPending,
              logger,
              specHash,
              skippedIds,
            );
          } catch {
            // replanOnFailure threw — treat as returning remaining pending unchanged
          }

          // Replace pending queue with replanOnFailure return value
          const pendingIds = new Set(updated.map(j => j.id));
          for (const j of allJobs) {
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
    durationMs,
  });

  return { totalCompleted, totalFailed, totalSkipped, durationMs };
}
