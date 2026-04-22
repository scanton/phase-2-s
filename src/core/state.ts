/**
 * Goal state — durable checkpointing for the dark factory.
 *
 * State is stored as JSON at:
 *   <specDir>/.phase2s/state/<sha256-of-spec-content>.json
 *
 * Writes are atomic: write to <hash>.json.tmp then rename to <hash>.json.
 * This prevents corrupted state files if the process is killed mid-write.
 *
 * All functions are pure (no module-level side effects). The MCP state tools
 * and goal.ts both call these functions — one implementation, two callers.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SubTaskResult {
  status: "passed" | "failed";
  completedAt?: string;
  /** Last ≤4096 chars of satori stdout/stderr for failed sub-tasks. */
  failureContext?: string;
  /** Inner satori retry count consumed for this sub-task. */
  attempts?: number;
}

export interface OrchestratorCompletedJobCheckpoint {
  job: import('../orchestrator/types.js').SubtaskJob;
  stdout: string;
}

export interface OrchestratorCheckpoint {
  completedJobs: OrchestratorCompletedJobCheckpoint[];
  pendingJobs: import('../orchestrator/types.js').SubtaskJob[];
  failedJobIds: string[];
  skippedJobIds: string[];
  suspectJobIds: string[];
  /** levelIdx at time of checkpoint — display-only, not used during resume execution. */
  currentLevel: number;
}

export interface GoalState {
  specFile: string;
  specHash: string;
  startedAt: string;
  lastUpdatedAt: string;
  maxAttempts: number;
  /** Outer retry loop count (how many full goal re-runs so far). */
  attempt: number;
  /** key = sub-task index (0-based string) */
  subTaskResults: Record<string, SubTaskResult>;

  // -- Parallel execution state --
  /** Whether this run uses parallel execution. */
  parallel?: boolean;
  /** Execution levels that have fully completed (all workers merged). */
  completedLevels?: number[];
  /** The level currently being executed. */
  currentLevel?: number;
  /** Per-level worker tracking for resume. */
  levelWorkers?: Record<string, LevelWorkerState[]>;

  /** Orchestrator checkpoint written on 429 rate-limit; cleared on successful completion. */
  orchestrator?: OrchestratorCheckpoint;
}

export interface LevelWorkerState {
  subtaskIndex: number;
  subtaskName: string;
  status: "pending" | "running" | "completed" | "failed";
  worktreePath?: string;
}

// ---------------------------------------------------------------------------
// Hash
// ---------------------------------------------------------------------------

/**
 * Compute a short SHA-256 hex digest of the spec file content.
 * Used as the state file key so renamed specs resume cleanly
 * and modified specs don't resume stale state.
 */
export function computeSpecHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function stateDir(cwd: string): string {
  return join(cwd, ".phase2s", "state");
}

function statePath(cwd: string, hash: string): string {
  return join(stateDir(cwd), `${hash}.json`);
}

function stateTmpPath(cwd: string, hash: string): string {
  return join(stateDir(cwd), `${hash}.json.tmp`);
}

// ---------------------------------------------------------------------------
// Read / Write / Clear
// ---------------------------------------------------------------------------

/**
 * Read state for a spec hash. Returns null if no state exists.
 *
 * @param cwd  Base directory (spec file dir from goal.ts, process.cwd() from MCP server).
 * @param hash SHA-256 hex digest of the spec content.
 */
export function readState(cwd: string, hash: string): GoalState | null {
  const path = statePath(cwd, hash);
  try {
    const raw = readFileSync(path, "utf8");
    return JSON.parse(raw) as GoalState;
  } catch {
    return null;
  }
}

/**
 * Write state atomically: write to .tmp then rename.
 * Creates the directory if it does not exist.
 *
 * @param cwd   Base directory.
 * @param hash  SHA-256 hex digest of the spec content.
 * @param state State object to persist.
 */
export function writeState(cwd: string, hash: string, state: GoalState): void {
  const dir = stateDir(cwd);
  mkdirSync(dir, { recursive: true });
  const tmp = stateTmpPath(cwd, hash);
  const dest = statePath(cwd, hash);
  writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
  renameSync(tmp, dest);
}

/**
 * Delete state for a spec hash. No-op if the file does not exist.
 *
 * @param cwd  Base directory.
 * @param hash SHA-256 hex digest of the spec content.
 */
export function clearState(cwd: string, hash: string): void {
  const path = statePath(cwd, hash);
  try {
    unlinkSync(path);
  } catch {
    // File doesn't exist — that's fine.
  }
}

// ---------------------------------------------------------------------------
// Raw key-value store (for MCP state tools)
// ---------------------------------------------------------------------------
// The MCP state_read/state_write/state_clear tools accept arbitrary string keys
// and JSON-serializable values — not the typed GoalState structure above.
// These functions use the same directory layout but operate on unknown values.

/**
 * Write any JSON-serializable value under a string key.
 * Creates the directory if needed. Write is atomic (tmp → rename).
 */
export function writeRawState(cwd: string, key: string, value: unknown): void {
  const dir = stateDir(cwd);
  mkdirSync(dir, { recursive: true });
  const tmp = stateTmpPath(cwd, key);
  const dest = statePath(cwd, key);
  writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
  renameSync(tmp, dest);
}

/**
 * Read a raw value by key. Returns null if not found or unparseable.
 */
export function readRawState(cwd: string, key: string): unknown {
  const path = statePath(cwd, key);
  try {
    const raw = readFileSync(path, "utf8");
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/**
 * Delete raw state by key. No-op if not found.
 */
export function clearRawState(cwd: string, key: string): void {
  const path = statePath(cwd, key);
  try {
    unlinkSync(path);
  } catch {
    // File doesn't exist — that's fine.
  }
}
