/**
 * RunLogger — structured JSONL event log for dark factory runs.
 *
 * Writes one JSONL event per log() call to:
 *   <specDir>/.phase2s/runs/<YYYY-MM-DDTHH-MM-SS>-<hash.slice(0,8)>.jsonl
 *
 * Directory is created lazily on first write.
 * Write errors are thrown (never silently dropped).
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

// ---------------------------------------------------------------------------
// RunEvent union
// ---------------------------------------------------------------------------

export type RunEvent =
  | { event: "goal_started"; specFile: string; specHash: string; subTaskCount: number; maxAttempts: number; resuming: boolean }
  | { event: "plan_review_started" }
  | { event: "plan_review_completed"; verdict: "APPROVED" | "CHALLENGED" | "NEEDS_CLARIFICATION"; response: string }
  | { event: "attempt_started"; attempt: number }
  | { event: "subtask_started"; attempt: number; index: number; name: string }
  | { event: "subtask_completed"; attempt: number; index: number; status: "passed" | "failed"; failureContext?: string }
  | { event: "eval_started"; command: string }
  | { event: "eval_completed"; output: string }
  | { event: "criteria_checked"; results: Record<string, boolean>; failing: string[] }
  | { event: "goal_completed"; success: boolean; attempts: number }
  | { event: "goal_error"; message: string };

// ---------------------------------------------------------------------------
// RunLogger
// ---------------------------------------------------------------------------

export class RunLogger {
  private readonly specDir: string;
  private readonly specHash: string;
  private readonly logPath: string;
  private initialized = false;

  constructor(specDir: string, specHash: string) {
    this.specDir = resolve(specDir);
    this.specHash = specHash;
    this.logPath = buildLogPath(this.specDir, specHash);
  }

  /**
   * Append a structured event to the JSONL log file.
   * Creates the runs directory on first call (lazy init).
   * Throws on write failure.
   */
  log(event: RunEvent): void {
    if (!this.initialized) {
      const runsDir = join(this.specDir, ".phase2s", "runs");
      mkdirSync(runsDir, { recursive: true });
      this.initialized = true;
    }

    const line = JSON.stringify({ ...event, ts: new Date().toISOString() }) + "\n";
    appendFileSync(this.logPath, line, "utf8");
  }

  /**
   * Return the absolute path to the log file.
   * The file may or may not exist yet (if log() was never called).
   */
  close(): string {
    return this.logPath;
  }
}

// ---------------------------------------------------------------------------
// Filename helpers
// ---------------------------------------------------------------------------

/**
 * Build the absolute path to the log file.
 * Filename: <YYYY-MM-DDTHH-MM-SS>-<hash.slice(0,8)>.jsonl
 */
export function buildLogPath(specDir: string, specHash: string): string {
  const now = new Date();
  const ts = formatTimestamp(now);
  const shortHash = specHash.slice(0, 8);
  const filename = `${ts}-${shortHash}.jsonl`;
  return resolve(join(specDir, ".phase2s", "runs", filename));
}

/**
 * Format a Date as YYYY-MM-DDTHH-MM-SS (colons replaced with hyphens for
 * filesystem-safe filenames).
 */
export function formatTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
  );
}
