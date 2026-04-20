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
  | { event: "goal_started"; specFile: string; specHash: string; subTaskCount: number; maxAttempts: number; resuming: boolean; parallel?: boolean; levels?: number }
  | { event: "plan_review_started" }
  | { event: "plan_review_completed"; verdict: "APPROVED" | "CHALLENGED" | "NEEDS_CLARIFICATION"; response: string }
  | { event: "attempt_started"; attempt: number }
  | { event: "subtask_started"; attempt: number; index: number; name: string }
  | { event: "subtask_completed"; attempt: number; index: number; status: "passed" | "failed"; failureContext?: string }
  | { event: "eval_started"; command: string }
  | { event: "eval_completed"; output: string }
  | { event: "criteria_checked"; results: Record<string, boolean>; failing: string[] }
  | { event: "goal_completed"; success: boolean; attempts: number; parallel?: boolean; wallClockMs?: number; sequentialEstimateMs?: number }
  | { event: "goal_error"; message: string }
  | { event: "eval_infra_error"; output: string }
  // Parallel execution events
  | { event: "level_started"; level: number; subtaskCount: number; workerCount: number }
  | { event: "level_completed"; level: number; durationMs: number; mergedCount: number; failedCount: number }
  | { event: "worker_started"; level: number; index: number; name: string; worktreePath: string }
  | { event: "worker_completed"; level: number; index: number; status: "passed" | "failed"; durationMs: number }
  | { event: "merge_started"; level: number; index: number }
  | { event: "merge_completed"; level: number; index: number; status: "success" | "conflict"; conflictFiles?: string[] }
  // Orchestrator events
  | { event: 'orchestrator_started'; specHash: string; totalJobs: number; levelCount: number }
  | { event: 'job_promoted'; specHash: string; subtaskId: string; role: string; level: number }
  | { event: 'job_routed'; specHash: string; subtaskId: string; role: string; systemPromptLength: number }
  | { event: 'orchestrator_context_missing'; specHash: string; subtaskId: string; level: number }
  | { event: 'orchestrator_replan_result'; specHash: string; failedSubtaskId: string; deltaCount: number; filteredCompletedCount: number; suspectCount: number; retriesUsed: number }
  | { event: 'orchestrator_replan_failed'; specHash: string; failedSubtaskId: string; errorMessage: string }
  | { event: 'orchestrator_completed'; specHash: string; totalCompleted: number; totalFailed: number; totalSkipped: number; suspectCount: number; durationMs: number }
  // Spec eval judge
  | {
      event: "eval_judged";
      runId: string;               // specHash — for v1.15.0 regression diffing
      ts: string;
      score: number | null;
      verdict: string;
      criteria: Array<{ text: string; status: "met" | "partial" | "missed"; evidence: string; confidence: number }>;
      diffStats: { filesChanged: number; insertions: number; deletions: number };
    };

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
