/**
 * Parallel executor for the dark factory.
 *
 * Executes subtasks in parallel within execution levels. Each level's
 * independent subtasks are spawned as separate workers, each in its own
 * git worktree with a fresh Agent instance.
 *
 * Architecture:
 *   dependency-graph.ts → execution levels
 *   parallel-executor.ts → worktree workers (this file)
 *   merge-strategy.ts → merge results at level boundaries
 *   level-context.ts → context injection for workers
 */

import { execSync, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import chalk from "chalk";
import { Agent } from "../core/agent.js";
import { RateLimitError } from "../core/rate-limit-error.js";
import { loadConfig } from "../core/config.js";
import { loadRelevantLearnings, formatLearningsForPrompt } from "../core/memory.js";
import type { SubTask, Spec } from "../core/spec-parser.js";
import { RunLogger, type RunEvent } from "../core/run-logger.js";
import { writeState, type GoalState, type LevelWorkerState } from "../core/state.js";
import type { ExecutionLevel, DependencyResult } from "./dependency-graph.js";
import { buildLevelContext } from "./level-context.js";
import { createDashboard, updateWorkerPane, teardownDashboard, type DashboardState } from "./tmux-dashboard.js";
import {
  createWorktree,
  removeWorktree,
  symlinkNodeModules,
  stashIfDirty,
  unstash,
  mergeLevel as mergeLevelWorktrees,
  type LevelMergeResult,
} from "./merge-strategy.js";
import { OrchestratorLevelRateLimitError } from '../orchestrator/types.js';
import type { SubtaskJob, OrchestratorLevelResult } from '../orchestrator/types.js';

// ---------------------------------------------------------------------------
// Worktree mutex — serializes prune+add per repo to prevent concurrent races
// ---------------------------------------------------------------------------

const worktreeLocks = new Map<string, Promise<void>>();

async function withWorktreeLock(repoPath: string, fn: () => Promise<void>): Promise<void> {
  const prev = worktreeLocks.get(repoPath) ?? Promise.resolve();
  const next = prev.then(fn);
  worktreeLocks.set(repoPath, next.catch(() => {}));
  return next;
}

/**
 * Clear all worktree locks. Call in beforeEach in tests that exercise the mutex.
 */
export function resetWorktreeLocks(): void {
  worktreeLocks.clear();
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParallelOptions {
  maxWorkers: number;
  dashboard: boolean;
  spec: Spec;
  specDir: string;
  specHash: string;
  state: GoalState;
  logger: RunLogger;
  attempt: number;
  /** Satori retry count per worker. */
  satoriRetries: number;
  /** Model override for satori workers. */
  satoriModel?: string;
  /**
   * Revised sub-task descriptions from the replan agent.
   * Key = sub-task name (exact match), value = revised description to use
   * instead of the original spec description.
   */
  revisedSubtasks?: Record<string, string>;
  /**
   * Subset of sub-task names to actually execute on this retry.
   * Workers whose sub-task name is NOT in this set immediately return success
   * without touching any files (no-op). When undefined, all sub-tasks run.
   */
  subsetToRun?: Set<string>;
}

export interface WorkerResult {
  index: number;
  subtaskName: string;
  status: "passed" | "failed" | "error";
  durationMs: number;
  output: string;
  worktreeBranch?: string;
  error?: string;
}

export interface LevelResult {
  level: number;
  workers: WorkerResult[];
  merge: LevelMergeResult | null;
  durationMs: number;
}

export interface ParallelResult {
  levels: LevelResult[];
  success: boolean;
  totalDurationMs: number;
  sequentialEstimateMs: number;
}

/** Worker timeout: 10 minutes per subtask. */
const WORKER_TIMEOUT_MS = 10 * 60 * 1000;

/** Max bytes of worker output to capture for failure context. */
const FAILURE_CONTEXT_MAX_BYTES = 4096;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Execute subtasks in parallel using execution levels from the dependency graph.
 */
export async function executeParallel(
  depResult: DependencyResult,
  options: ParallelOptions,
): Promise<ParallelResult> {
  const { spec, specDir, specHash, state, logger, attempt, maxWorkers } = options;
  const cwd = process.cwd();
  const totalStart = Date.now();
  const levelResults: LevelResult[] = [];
  let sequentialEstimateMs = 0;

  // Get base commit for level context
  const baseCommit = getHeadCommit(cwd);

  // Pre-flight: stash if dirty (named stash with specHash to avoid index-based ambiguity)
  const stashed = stashIfDirty(cwd, specHash);

  // Optional tmux dashboard
  const dashboard = options.dashboard
    ? createDashboard(spec.title, Math.min(maxWorkers, depResult.levels[0]?.subtaskIndices.length ?? 1))
    : null;

  try {
    for (const level of depResult.levels) {
      // Skip completed levels on resume
      if (state.completedLevels?.includes(level.level)) {
        console.log(chalk.dim(`\n[skip] Level ${level.level} (completed in prior run)`));
        continue;
      }

      const levelResult = await executeLevel(level, {
        ...options,
        cwd,
        baseCommit,
        maxWorkers: Math.min(maxWorkers, level.subtaskIndices.length),
        dashboardState: dashboard,
      });

      levelResults.push(levelResult);

      // Track sequential estimate (sum of all worker durations)
      for (const w of levelResult.workers) {
        sequentialEstimateMs += w.durationMs;
      }

      // Update state: mark level completed
      if (levelResult.merge?.success ?? levelResult.workers.every(w => w.status === "passed")) {
        state.completedLevels = [...(state.completedLevels ?? []), level.level];
        state.currentLevel = level.level + 1;
        state.lastUpdatedAt = new Date().toISOString();
        writeState(specDir, specHash, state);
      } else {
        // Level failed — stop parallel execution
        console.log(chalk.red(`\nLevel ${level.level} failed. Stopping parallel execution.`));
        break;
      }
    }
  } finally {
    if (stashed) unstash(cwd, specHash);
    if (dashboard) teardownDashboard(dashboard);
  }

  const totalDurationMs = Date.now() - totalStart;
  const allSuccess = levelResults.every(l =>
    l.merge?.success ?? l.workers.every(w => w.status === "passed"),
  );

  return {
    levels: levelResults,
    success: allSuccess,
    totalDurationMs,
    sequentialEstimateMs,
  };
}

// ---------------------------------------------------------------------------
// Level execution
// ---------------------------------------------------------------------------

interface LevelOptions extends ParallelOptions {
  cwd: string;
  baseCommit: string;
  dashboardState: DashboardState | null;
}

async function executeLevel(
  level: ExecutionLevel,
  options: LevelOptions,
): Promise<LevelResult> {
  const { cwd, spec, specDir, specHash, state, logger, attempt, baseCommit, maxWorkers } = options;
  const levelStart = Date.now();
  const subtasks = level.subtaskIndices.map(i => ({ index: i, subtask: spec.decomposition[i] }));

  console.log(chalk.cyan(`\n[Level ${level.level}] Running ${subtasks.length} subtask${subtasks.length > 1 ? "s" : ""} in parallel (max ${maxWorkers} workers)`));

  logger.log({
    event: "level_started",
    level: level.level,
    subtaskCount: subtasks.length,
    workerCount: Math.min(maxWorkers, subtasks.length),
  });

  // Update state
  state.currentLevel = level.level;
  state.levelWorkers = state.levelWorkers ?? {};
  state.levelWorkers[String(level.level)] = subtasks.map(s => ({
    subtaskIndex: s.index,
    subtaskName: s.subtask.name,
    status: "pending" as const,
  }));
  writeState(specDir, specHash, state);

  // Build level context (what prior levels changed)
  const levelContext = level.level > 0 ? buildLevelContext(cwd, baseCommit) : "";

  // Execute workers in batches of maxWorkers.
  // AbortController per batch: when one worker hits a 429, onRateLimitDetected fires
  // abort() immediately (while siblings are still in-flight), terminating their streams.
  // Promise.allSettled collects all settled results so completed sibling work is preserved.
  // The first RateLimitError is re-thrown after merge so goal.ts can checkpoint and exit 2.
  //
  // Note: executeWorker() only throws RateLimitError — all other failures are returned as
  // WorkerResult { status: "failed" } in the fulfilled results. The rejected branch below
  // is a safety net in case that contract changes.
  const workerResults: WorkerResult[] = [];
  let batchRateLimitErr: RateLimitError | undefined;
  for (let batch = 0; batch < subtasks.length; batch += maxWorkers) {
    const batchSubtasks = subtasks.slice(batch, batch + maxWorkers);
    const controller = new AbortController();
    const settled = await Promise.allSettled(
      batchSubtasks.map(({ index, subtask }, batchIdx) =>
        executeWorker(index, subtask, level.level, {
          ...options,
          levelContext,
          workerIndexInBatch: batch + batchIdx,
          signal: controller.signal,
          onRateLimitDetected: () => controller.abort(),
        }),
      ),
    );
    for (const r of settled) {
      if (r.status === "fulfilled") {
        workerResults.push(r.value);
      } else if (r.reason instanceof RateLimitError && !batchRateLimitErr) {
        batchRateLimitErr = r.reason;
        // Continue collecting other settled results — do not break early.
      }
      // Note: executeWorker() only throws RateLimitError — all other failures are
      // returned as WorkerResult { status: "failed" } and appear in fulfilled results.
      // This branch is a safety net in case executeWorker's contract changes.
    }
    // Stop scheduling new batches if a rate limit was detected.
    if (batchRateLimitErr) break;
  }

  // Log worker results
  for (const w of workerResults) {
    logger.log({
      event: "worker_completed",
      level: level.level,
      index: w.index,
      status: w.status === "passed" ? "passed" : "failed",
      durationMs: w.durationMs,
    });

    // Update subtask result in state
    const indexKey = String(w.index);
    state.subTaskResults[indexKey] = {
      status: w.status === "passed" ? "passed" : "failed",
      completedAt: new Date().toISOString(),
      failureContext: w.status !== "passed" ? w.output.slice(-FAILURE_CONTEXT_MAX_BYTES) : undefined,
      attempts: 1,
    };
  }
  writeState(specDir, specHash, state);

  // Merge completed workers
  const successfulWorkers = workerResults.filter(w => w.status === "passed" && w.worktreeBranch);
  let mergeResult: LevelMergeResult | null = null;

  if (successfulWorkers.length > 0) {
    console.log(chalk.cyan(`\n[Level ${level.level}] Merging ${successfulWorkers.length} worker${successfulWorkers.length > 1 ? "s" : ""}...`));

    mergeResult = mergeLevelWorktrees(
      cwd,
      successfulWorkers.map(w => ({
        index: w.index,
        subtaskName: w.subtaskName,
        worktreeBranch: w.worktreeBranch!,
      })),
      level.level,
    );

    // Log merge results
    for (const mr of mergeResult.results) {
      logger.log({ event: "merge_started", level: level.level, index: mr.index });
      logger.log({
        event: "merge_completed",
        level: level.level,
        index: mr.index,
        status: mr.status === "success" ? "success" : "conflict",
        conflictFiles: mr.conflictFiles,
      });
    }

    if (mergeResult.success) {
      console.log(chalk.green(`[Level ${level.level}] All merges successful.`));
    } else {
      const failedMerge = mergeResult.results.find(r => r.status !== "success");
      if (failedMerge?.status === "conflict") {
        console.log(chalk.red(`[Level ${level.level}] Merge conflict in: ${failedMerge.conflictFiles?.join(", ")}`));
      } else if (failedMerge) {
        console.log(chalk.red(`[Level ${level.level}] Merge error: ${failedMerge.error}`));
      }
    }
  }

  // Cleanup worktrees for this level
  for (const { index } of subtasks) {
    const slug = makeWorktreeSlug(specHash, index);
    removeWorktree(cwd, slug);
  }

  const levelDurationMs = Date.now() - levelStart;

  logger.log({
    event: "level_completed",
    level: level.level,
    durationMs: levelDurationMs,
    mergedCount: mergeResult?.results.filter(r => r.status === "success").length ?? 0,
    failedCount: workerResults.filter(w => w.status !== "passed").length,
  });

  // Re-throw after merge + cleanup so fulfilled workers' changes are preserved.
  // goal.ts catches RateLimitError, checkpoints, and exits with code 2.
  if (batchRateLimitErr) {
    throw batchRateLimitErr;
  }

  return {
    level: level.level,
    workers: workerResults,
    merge: mergeResult,
    durationMs: levelDurationMs,
  };
}

// ---------------------------------------------------------------------------
// Worker execution
// ---------------------------------------------------------------------------

interface WorkerOptions extends LevelOptions {
  levelContext: string;
  workerIndexInBatch: number;
  /** AbortSignal from the per-batch AbortController. Set when a sibling hits a rate limit. */
  signal?: AbortSignal;
  /** Called inside executeWorker before throwing RateLimitError, while siblings are still in-flight. */
  onRateLimitDetected?: () => void;
}

async function executeWorker(
  index: number,
  subtask: SubTask,
  level: number,
  options: WorkerOptions,
): Promise<WorkerResult> {
  const { cwd, spec, specDir, specHash, state, logger, attempt, levelContext, satoriRetries, satoriModel, dashboardState, workerIndexInBatch, subsetToRun, revisedSubtasks } = options;
  const start = Date.now();
  const slug = makeWorktreeSlug(specHash, index);

  // If subsetToRun is defined and this sub-task is not in it, skip execution
  // and return an immediate no-op success. This lets the retry loop re-run
  // only failing sub-tasks without wasting workers on passing ones.
  if (subsetToRun !== undefined && !subsetToRun.has(subtask.name)) {
    console.log(chalk.dim(`  [Worker ${index}] Skipping (already passed): ${subtask.name}`));
    return {
      index,
      subtaskName: subtask.name,
      status: "passed",
      durationMs: Date.now() - start,
      output: "(skipped — sub-task passed in prior attempt)",
    };
  }

  console.log(chalk.yellow(`  [Worker ${index}] Starting: ${subtask.name}`));
  if (dashboardState) updateWorkerPane(dashboardState, workerIndexInBatch, `[Worker ${index}] ${subtask.name}`);

  logger.log({
    event: "worker_started",
    level,
    index,
    name: subtask.name,
    worktreePath: `${cwd}/.worktrees/${slug}`,
  });

  // Check for persisted worktree path from a previous run
  const persistedWorkers = state.levelWorkers?.[String(level)];
  const persistedWorker = persistedWorkers?.find(w => w.subtaskIndex === index);

  let wt: { worktreePath: string; branchName: string } | { error: string };

  if (persistedWorker?.worktreePath && existsSync(persistedWorker.worktreePath)) {
    // Resume: reuse existing worktree
    wt = { worktreePath: persistedWorker.worktreePath, branchName: `parallel/${slug}` };
  } else if (persistedWorker?.worktreePath && !existsSync(persistedWorker.worktreePath)) {
    // Path recorded but directory missing — prune and recreate (serialized per repo to avoid race)
    let pruneResult: { worktreePath: string; branchName: string } | { error: string } = { error: "not started" };
    await withWorktreeLock(cwd, async () => {
      try { execSync("git worktree prune", { cwd, stdio: "pipe" }); } catch { /* ok */ }
      pruneResult = createWorktree(cwd, slug);
    });
    wt = pruneResult;
  } else {
    // Normal fresh worktree creation
    wt = createWorktree(cwd, slug);
  }

  if ("error" in wt) {
    console.log(chalk.red(`  [Worker ${index}] Failed to create worktree: ${wt.error}`));
    return {
      index,
      subtaskName: subtask.name,
      status: "error",
      durationMs: Date.now() - start,
      output: wt.error,
      error: wt.error,
    };
  }

  // Write state BEFORE first await — serializes correctly on Node.js event loop
  // (multiple concurrent workers; sync operations before first await don't interleave)
  state.levelWorkers ??= {};
  state.levelWorkers[String(level)] ??= [];
  const existingEntry = state.levelWorkers[String(level)].find(w => w.subtaskIndex === index);
  if (existingEntry) {
    existingEntry.status = "running";
    existingEntry.worktreePath = wt.worktreePath;
  } else {
    state.levelWorkers[String(level)].push({
      subtaskIndex: index,
      subtaskName: subtask.name,
      status: "running",
      worktreePath: wt.worktreePath,
    });
  }
  writeState(specDir, specHash, state);

  // Symlink node_modules
  symlinkNodeModules(cwd, wt.worktreePath);

  // Build satori prompt with level context.
  // Use revised description from replan agent if available (retry path).
  const revisedDescription = revisedSubtasks?.[subtask.name];
  const prompt = buildWorkerPrompt(subtask, spec, levelContext, revisedDescription);

  // Create fresh Agent for this worker — semantic learnings lookup using subtask name
  const config = await loadConfig();
  const learningsList = await loadRelevantLearnings(cwd, subtask.name, config);
  const learnings = formatLearningsForPrompt(learningsList, { skipCharCap: config.ollamaBaseUrl !== undefined });
  const agent = new Agent({
    config,
    learnings,
    cwd: wt.worktreePath,
  });

  // Resolve per-subtask model (subtask.model annotation overrides outer satoriModel)
  const workerModel = resolveSubtaskModel(subtask.model, config, satoriModel);

  // Execute satori in the worktree
  const outputChunks: string[] = [];
  let workerError: unknown = null;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error(`Worker timeout after ${WORKER_TIMEOUT_MS / 1000}s`)), WORKER_TIMEOUT_MS);
    });

    const runPromise = agent.run(prompt, {
      modelOverride: workerModel,
      maxRetries: satoriRetries,
      verifyCommand: spec.evalCommand,
      signal: options.signal,
      onDelta: (chunk) => {
        outputChunks.push(chunk);
      },
    });

    await Promise.race([runPromise, timeoutPromise]);
  } catch (err) {
    workerError = err;
  } finally {
    clearTimeout(timeoutHandle);
  }

  const output = outputChunks.join("");
  const durationMs = Date.now() - start;
  const durationStr = `${(durationMs / 1000).toFixed(1)}s`;

  if (workerError) {
    // Rate limit errors must propagate — they are not per-worker failures.
    // Fire the abort callback first so siblings are cancelled while still in-flight.
    if (workerError instanceof RateLimitError) {
      options.onRateLimitDetected?.();
      throw workerError;
    }
    console.log(chalk.red(`  [Worker ${index}] Failed (${durationStr}): ${subtask.name}`));
    return {
      index,
      subtaskName: subtask.name,
      status: "failed",
      durationMs,
      output: output + `\n\nError: ${workerError instanceof Error ? workerError.message : String(workerError)}`,
      worktreeBranch: wt.branchName,
      error: workerError instanceof Error ? workerError.message : String(workerError),
    };
  }

  // agent.ts handles AbortSignal with a clean break (no throw). Check after the run
  // so aborted workers are returned as failed, not as successful no-ops.
  if (options.signal?.aborted) {
    return {
      index,
      subtaskName: subtask.name,
      status: "failed",
      durationMs,
      output: "(aborted — sibling hit rate limit)",
    };
  }

  // Commit the worker's changes in the worktree
  try {
    const safeMsg = `parallel: ${subtask.name}`.replace(/"/g, '\\"');
    execSync(`git add -A && git diff --cached --quiet || git commit -m "${safeMsg}"`, {
      cwd: wt.worktreePath,
      encoding: "utf8",
      stdio: "pipe",
      shell: "/bin/sh",
    });
  } catch {
    // No changes to commit — that's fine
  }

  console.log(chalk.green(`  [Worker ${index}] Done (${durationStr}): ${subtask.name}`));

  return {
    index,
    subtaskName: subtask.name,
    status: "passed",
    durationMs,
    output,
    worktreeBranch: wt.branchName,
  };
}

// ---------------------------------------------------------------------------
// Model resolution
// ---------------------------------------------------------------------------

/**
 * Known model name prefixes used to detect potential typos in literal `model:` annotations.
 * Intentionally a best-effort heuristic, not an authoritative allowlist — unrecognized
 * values pass through with a console.warn (they may be valid provider-specific IDs).
 * Update this list when adding new provider support to keep warnings accurate.
 */
const KNOWN_MODEL_PREFIXES = ["gpt-", "claude-", "o1", "o3", "gemini-", "deepseek-", "minimax", "openai/", "anthropic/", "google/"];

/**
 * Resolve a subtask's model annotation against config.
 *
 * - "fast" → config.fast_model (undefined if not set)
 * - "smart" → config.smart_model (undefined if not set)
 * - literal string → passthrough, with a warning if it doesn't look like a known model
 * - undefined → falls back to the outer satoriModel option
 */
export function resolveSubtaskModel(
  annotation: string | undefined,
  config: { fast_model?: string; smart_model?: string },
  fallback?: string,
): string | undefined {
  if (!annotation) return fallback;
  const alias = annotation.toLowerCase();
  if (alias === "fast") return config.fast_model ?? fallback;
  if (alias === "smart") return config.smart_model ?? fallback;
  // Literal model name passthrough — warn if it doesn't look like a known format
  if (!KNOWN_MODEL_PREFIXES.some(p => alias.startsWith(p))) {
    console.warn(`[phase2s] Unknown model annotation: "${annotation}". Passing through — check your spec.`);
  }
  return annotation;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function buildWorkerPrompt(subtask: SubTask, spec: Spec, levelContext: string, revisedDescription?: string): string {
  const parts: string[] = [];

  if (levelContext) {
    parts.push("CONTEXT FROM PRIOR EXECUTION LEVELS:");
    parts.push(levelContext);
    parts.push("");
  }

  if (revisedDescription) {
    parts.push(`TASK: ${subtask.name}`);
    parts.push(`REVISED INSTRUCTIONS (a prior attempt failed — follow these updated instructions):`);
    parts.push(revisedDescription);
    parts.push(`SUCCESS CRITERIA: ${subtask.successCriteria}`);
  } else {
    parts.push(`TASK: ${subtask.name}`);
    if (subtask.input) parts.push(`INPUT: ${subtask.input}`);
    if (subtask.output) parts.push(`EXPECTED OUTPUT: ${subtask.output}`);
    if (subtask.successCriteria) parts.push(`SUCCESS CRITERIA: ${subtask.successCriteria}`);
  }

  if (spec.constraints.mustDo.length > 0) {
    parts.push(`\nCONSTRAINTS (must do): ${spec.constraints.mustDo.join("; ")}`);
  }
  if (spec.constraints.cannotDo.length > 0) {
    parts.push(`CONSTRAINTS (cannot do): ${spec.constraints.cannotDo.join("; ")}`);
  }

  parts.push("\nImplement this task. Make all necessary code changes. Ensure tests pass.");

  return parts.join("\n");
}

/**
 * Execute a level of SubtaskJobs for the orchestrator.
 * Each job gets an Agent with job.systemPromptPrefix as its system prompt.
 * Workers are in-process Agent instances — no subprocess spawning.
 * Returns OrchestratorLevelResult[] with stdout captured for sentinel extraction.
 *
 * Named executeOrchestratorLevel to avoid collision with private executeLevel() above.
 */
export async function executeOrchestratorLevel(
  jobs: SubtaskJob[],
  modelOverride?: string,
): Promise<OrchestratorLevelResult[]> {
  const cwd = process.cwd();

  // Hoist shared reads outside Promise.all to avoid N redundant file reads per level.
  // Use job titles concatenated as the semantic query — all workers at this level share learnings.
  const config = await loadConfig();
  const levelQuery = jobs.map((j) => j.title).join(" ");
  const learningsList = await loadRelevantLearnings(cwd, levelQuery, config);
  const learnings = formatLearningsForPrompt(learningsList, { skipCharCap: config.ollamaBaseUrl !== undefined });

  const controller = new AbortController();
  const jobPromises = jobs.map(async (job, batchIdx): Promise<OrchestratorLevelResult> => {
    const slug = makeWorktreeSlug(`orch${Date.now().toString(36).slice(-4)}`, batchIdx);

    const wt = createWorktree(cwd, slug);
    if ('error' in wt) {
      return { subtaskId: job.id, status: 'failed', error: wt.error };
    }

    try {
      symlinkNodeModules(cwd, wt.worktreePath);
    } catch (err) {
      // symlink failed — clean up worktree and fail this job rather than rejecting Promise.all
      removeWorktree(cwd, slug);
      return { subtaskId: job.id, status: 'failed', error: err instanceof Error ? err.message : String(err) };
    }

    const outputChunks: string[] = [];
    let workerError: unknown = null;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    try {
      const agent = new Agent({
        config,
        learnings,
        cwd: wt.worktreePath,
        systemPrompt: job.systemPromptPrefix || undefined,
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error(`Worker timeout after ${WORKER_TIMEOUT_MS / 1000}s`)), WORKER_TIMEOUT_MS);
      });

      await Promise.race([
        agent.run(job.prompt, { modelOverride, onDelta: (chunk) => { outputChunks.push(chunk); }, signal: controller.signal }),
        timeoutPromise,
      ]);
    } catch (err) {
      workerError = err;
    } finally {
      clearTimeout(timeoutHandle);
    }

    // Commit worker changes (execFileSync avoids shell injection from job.title)
    try {
      execFileSync('git', ['add', '-A'], { cwd: wt.worktreePath, encoding: 'utf8', stdio: 'pipe' });
      try {
        execFileSync('git', ['diff', '--cached', '--quiet'], { cwd: wt.worktreePath, encoding: 'utf8', stdio: 'pipe' });
        // exit 0 → no staged changes, nothing to commit
      } catch {
        // exit non-zero → staged changes exist → commit
        execFileSync('git', ['commit', '-m', `orchestrator: ${job.title}`], {
          cwd: wt.worktreePath, encoding: 'utf8', stdio: 'pipe',
        });
      }
    } catch { /* no changes to commit */ }

    removeWorktree(cwd, slug);

    const stdout = outputChunks.join('');
    if (workerError) {
      if (workerError instanceof RateLimitError) throw workerError;
      return {
        subtaskId: job.id,
        status: 'failed',
        error: workerError instanceof Error ? workerError.message : String(workerError),
        stdout,
      };
    }

    return { subtaskId: job.id, status: 'completed', stdout };
  });
  const settled = await Promise.allSettled(
    jobPromises.map(p => p.catch((err: unknown) => {
      if (err instanceof RateLimitError) controller.abort();
      throw err;
    }))
  );

  // Collect partial results from fulfilled workers; detect any 429 rejection
  const results: OrchestratorLevelResult[] = [];
  let rateLimitErr: RateLimitError | undefined;

  for (const outcome of settled) {
    if (outcome.status === 'fulfilled') {
      results.push(outcome.value);
    } else {
      if (outcome.reason instanceof RateLimitError && !rateLimitErr) {
        rateLimitErr = outcome.reason;
      }
      // Non-RateLimitError rejections shouldn't happen (per-job catch returns {status:'failed'})
      // but guard defensively — treat as failed result with no stdout
    }
  }

  if (rateLimitErr) {
    const arg: number | 'blocked' | undefined =
      rateLimitErr.kind === 'blocked' ? 'blocked' : rateLimitErr.retryAfter;
    throw new OrchestratorLevelRateLimitError(arg, results);
  }

  return results;
}

export function makeWorktreeSlug(specHash: string, index: number): string {
  return `ph2s-${specHash.slice(0, 8)}-${index}`;
}

function getHeadCommit(cwd: string): string {
  try {
    return execSync("git rev-parse HEAD", { cwd, encoding: "utf8" }).trim();
  } catch {
    return "HEAD";
  }
}
