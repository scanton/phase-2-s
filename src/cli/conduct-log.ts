/**
 * phase2s conduct-log — append-only JSONL run log for conductor executions.
 *
 * Every `phase2s conduct` run (success or failure) appends one entry to
 * `.phase2s/conduct-log.jsonl` in the project working directory.
 *
 * The `phase2s conduct-log` command reads this file and renders a table of
 * recent runs (default: 10 most recent).
 *
 * Design decisions (Sprint 90 engineering review):
 *   - appendConductLog() calls mkdir before appendFile so the function is
 *     safe to call even when conductorGenSpec() exited early (before its
 *     own mkdir ran), e.g. on LLM timeout.
 *   - readConductLog() wraps each JSON.parse() in try/catch and skips
 *     malformed lines (partial writes from killed processes must not crash
 *     the log command).
 *   - The caller in runConduct() wraps appendConductLog() in its own
 *     try/catch so a log write failure never masks the real exit code.
 */

import { appendFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export interface ConductLogEntry {
  /** ISO 8601 timestamp of the run. */
  ts: string;
  /** Raw goal string, truncated at 200 chars. */
  goal: string;
  /** Absolute path to the generated spec file on disk. */
  specPath: string;
  /** First 8 hex chars of sha256(specContent). Empty string on spec gen failure. */
  specHash: string;
  /** Number of subtasks in the spec (spec.decomposition.length). */
  subtaskCount: number;
  /** Unique role names extracted from the spec's decomposition. */
  roles: string[];
  /** Whether runGoal returned success. False when spec gen failed. */
  success: boolean;
  /** Wall-clock milliseconds from runConduct() start to finally block. */
  durationMs: number;
  /** Path to the goal-level JSONL run log (result.runLogPath). Empty on failure. */
  runLogPath: string;
  /** Number of refinement rounds taken (0 = no refinement). */
  rounds: number;
}

// ---------------------------------------------------------------------------
// appendConductLog
// ---------------------------------------------------------------------------

/**
 * Append one entry to `.phase2s/conduct-log.jsonl`.
 *
 * Creates the `.phase2s/` directory if it doesn't exist — safe to call even
 * when `conductorGenSpec()` exited early before its own `mkdir` ran.
 *
 * @throws on unexpected I/O errors (caller should wrap in try/catch).
 */
export async function appendConductLog(
  entry: ConductLogEntry,
  cwd: string,
): Promise<void> {
  const phase2sDir = join(cwd, ".phase2s");
  await mkdir(phase2sDir, { recursive: true });
  const logPath = join(phase2sDir, "conduct-log.jsonl");
  await appendFile(logPath, JSON.stringify(entry) + "\n", "utf8");
}

// ---------------------------------------------------------------------------
// readConductLog
// ---------------------------------------------------------------------------

/**
 * Read entries from `.phase2s/conduct-log.jsonl`, newest first.
 *
 * @param cwd   Project working directory.
 * @param limit Maximum number of entries to return. Omit to return all entries.
 *              The CLI layer applies a default of 10.
 * @returns     Array of parsed entries, newest first. Empty array if no log exists.
 *
 * Malformed lines (partial writes from killed processes) are silently skipped.
 */
export async function readConductLog(
  cwd: string,
  limit?: number,
): Promise<ConductLogEntry[]> {
  const logPath = join(cwd, ".phase2s", "conduct-log.jsonl");
  let raw: string;
  try {
    raw = await readFile(logPath, "utf8");
  } catch {
    return [];
  }

  const entries: ConductLogEntry[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed) as ConductLogEntry);
    } catch {
      // Silently skip malformed lines (partial writes from killed processes).
    }
  }

  // Reverse to newest-first, then apply limit.
  entries.reverse();
  return limit !== undefined ? entries.slice(0, limit) : entries;
}

// ---------------------------------------------------------------------------
// renderConductLog — table display
// ---------------------------------------------------------------------------

/**
 * Render a table of conduct log entries to stdout.
 *
 * Columns: DATE | GOAL (truncated) | SUBTASKS | RESULT | DURATION
 *
 * Date format: `YYYY-MM-DD HHh` (local time, hour precision).
 * Goal truncated to 32 chars for table display.
 */
export function renderConductLog(entries: ConductLogEntry[]): void {
  if (entries.length === 0) {
    console.log(chalk.dim("  No conduct runs logged yet."));
    return;
  }

  const header = [
    "  DATE            ",
    "GOAL                            ",
    "SUBTASKS  ",
    "RESULT    ",
    "DURATION",
  ].join("");
  console.log(chalk.dim(header));

  for (const e of entries) {
    const date = formatLogDate(e.ts);
    const goal = e.goal.slice(0, 32).padEnd(32);
    const subtasks = String(e.subtaskCount).padEnd(10);
    const result = e.success
      ? chalk.green("✓ pass".padEnd(10))
      : chalk.red("✗ fail".padEnd(10));
    const duration = formatLogDuration(e.durationMs);
    console.log(`  ${date}  ${goal}  ${subtasks}${result}${duration}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format an ISO 8601 timestamp as `YYYY-MM-DD HHh` (local time, hour precision).
 * Example: "2026-05-10 21h"
 */
function formatLogDate(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "????-??-?? ??h";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}h`;
}

/**
 * Format milliseconds as a human-readable duration string.
 * Examples: "0s", "45s", "2m 34s", "1h 2m 3s"
 */
function formatLogDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}
