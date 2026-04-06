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

import { execSync } from "node:child_process";
import chalk from "chalk";
import { Agent } from "../core/agent.js";
import { loadConfig } from "../core/config.js";
import { loadLearnings, formatLearningsForPrompt } from "../core/memory.js";
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

  // Pre-flight: stash if dirty
  const stashed = stashIfDirty(cwd);

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
    if (stashed) unstash(cwd);
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

  // Execute workers in batches of maxWorkers
  const workerResults: WorkerResult[] = [];
  for (let batch = 0; batch < subtasks.length; batch += maxWorkers) {
    const batchSubtasks = subtasks.slice(batch, batch + maxWorkers);
    const batchResults = await Promise.all(
      batchSubtasks.map(({ index, subtask }, batchIdx) =>
        executeWorker(index, subtask, level.level, {
          ...options,
          levelContext,
          workerIndexInBatch: batch + batchIdx,
        }),
      ),
    );
    workerResults.push(...batchResults);
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
  for (const { index, subtask } of subtasks) {
    const slug = makeWorktreeSlug(subtask.name, index);
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
}

async function executeWorker(
  index: number,
  subtask: SubTask,
  level: number,
  options: WorkerOptions,
): Promise<WorkerResult> {
  const { cwd, spec, logger, attempt, levelContext, satoriRetries, satoriModel, dashboardState, workerIndexInBatch } = options;
  const start = Date.now();
  const slug = makeWorktreeSlug(subtask.name, index);

  console.log(chalk.yellow(`  [Worker ${index}] Starting: ${subtask.name}`));
  if (dashboardState) updateWorkerPane(dashboardState, workerIndexInBatch, `[Worker ${index}] ${subtask.name}`);

  logger.log({
    event: "worker_started",
    level,
    index,
    name: subtask.name,
    worktreePath: `${cwd}/.worktrees/${slug}`,
  });

  // Create worktree
  const wt = createWorktree(cwd, slug);
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

  // Symlink node_modules
  symlinkNodeModules(cwd, wt.worktreePath);

  // Build satori prompt with level context
  const prompt = buildWorkerPrompt(subtask, spec, levelContext);

  // Create fresh Agent for this worker
  const config = await loadConfig();
  const learningsList = await loadLearnings(cwd);
  const learnings = formatLearningsForPrompt(learningsList);
  const agent = new Agent({
    config,
    learnings,
    cwd: wt.worktreePath,
  });

  // Execute satori in the worktree
  const outputChunks: string[] = [];
  let workerError: unknown = null;

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Worker timeout after ${WORKER_TIMEOUT_MS / 1000}s`)), WORKER_TIMEOUT_MS);
    });

    const runPromise = agent.run(prompt, {
      modelOverride: satoriModel,
      maxRetries: satoriRetries,
      verifyCommand: spec.evalCommand,
      onDelta: (chunk) => {
        outputChunks.push(chunk);
      },
    });

    await Promise.race([runPromise, timeoutPromise]);
  } catch (err) {
    workerError = err;
  }

  const output = outputChunks.join("");
  const durationMs = Date.now() - start;
  const durationStr = `${(durationMs / 1000).toFixed(1)}s`;

  if (workerError) {
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
// Helpers
// ---------------------------------------------------------------------------

function buildWorkerPrompt(subtask: SubTask, spec: Spec, levelContext: string): string {
  const parts: string[] = [];

  if (levelContext) {
    parts.push("CONTEXT FROM PRIOR EXECUTION LEVELS:");
    parts.push(levelContext);
    parts.push("");
  }

  parts.push(`TASK: ${subtask.name}`);
  if (subtask.input) parts.push(`INPUT: ${subtask.input}`);
  if (subtask.output) parts.push(`EXPECTED OUTPUT: ${subtask.output}`);
  if (subtask.successCriteria) parts.push(`SUCCESS CRITERIA: ${subtask.successCriteria}`);

  if (spec.constraints.mustDo.length > 0) {
    parts.push(`\nCONSTRAINTS (must do): ${spec.constraints.mustDo.join("; ")}`);
  }
  if (spec.constraints.cannotDo.length > 0) {
    parts.push(`CONSTRAINTS (cannot do): ${spec.constraints.cannotDo.join("; ")}`);
  }

  parts.push("\nImplement this task. Make all necessary code changes. Ensure tests pass.");

  return parts.join("\n");
}

export function makeWorktreeSlug(subtaskName: string, index: number): string {
  const slug = subtaskName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const short = Math.random().toString(36).slice(2, 8);
  return `${slug}-${index}-${short}`;
}

function getHeadCommit(cwd: string): string {
  try {
    return execSync("git rev-parse HEAD", { cwd, encoding: "utf8" }).trim();
  } catch {
    return "HEAD";
  }
}
