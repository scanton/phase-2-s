/**
 * Run log report viewer.
 *
 * Parses a structured JSONL run log (produced by RunLogger) and renders a
 * chalk-colored human-readable summary of the dark factory run.
 *
 * Usage: phase2s report <logfile.jsonl>
 *
 * The report shows:
 * - Spec filename
 * - Pre-execution review verdict (if applicable)
 * - Per-attempt: sub-task status + duration, eval command, criteria verdicts
 * - Final outcome + total duration
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import chalk from "chalk";
import type { RunEvent } from "../core/run-logger.js";

// ---------------------------------------------------------------------------
// Structured report types
// ---------------------------------------------------------------------------

export interface SubtaskReport {
  index: number;
  name: string;
  status: "passed" | "failed";
  durationMs?: number;
  failureContext?: string;
}

export interface AttemptReport {
  attempt: number;
  subtasks: SubtaskReport[];
  evalCommand?: string;
  criteria: Array<{ criterion: string; passed: boolean }>;
}

export interface RunReport {
  specFile: string;
  maxAttempts: number;
  challenged: boolean;
  challengeVerdict?: string;
  attempts: AttemptReport[];
  finalSuccess: boolean;
  finalAttempts: number;
  durationMs?: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a JSONL run log file into a list of timestamped RunEvents.
 * Throws if the file cannot be read.
 */
export function parseRunLog(logPath: string): Array<RunEvent & { ts: string }> {
  const raw = readFileSync(logPath, "utf8");
  return raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RunEvent & { ts: string });
}

/**
 * Build a structured RunReport from a list of timestamped RunEvents.
 * Unknown or out-of-order events are silently ignored.
 */
export function buildRunReport(events: Array<RunEvent & { ts: string }>): RunReport {
  const report: RunReport = {
    specFile: "",
    maxAttempts: 3,
    challenged: false,
    attempts: [],
    finalSuccess: false,
    finalAttempts: 0,
  };

  let startTs: Date | null = null;
  let currentAttempt: AttemptReport | null = null;

  // Track start times for duration computation
  const subtaskStartTimes = new Map<string, Date>(); // key: `${attempt}:${index}`
  const subtaskNames = new Map<number, string>();    // key: index

  for (const raw of events) {
    const ts = new Date(raw.ts);
    const event = raw as RunEvent;

    switch (event.event) {
      case "goal_started":
        report.specFile = event.specFile;
        report.maxAttempts = event.maxAttempts;
        startTs = ts;
        break;

      case "plan_review_completed":
        if (event.verdict !== "APPROVED") {
          report.challenged = true;
          report.challengeVerdict = event.verdict;
        }
        break;

      case "attempt_started":
        currentAttempt = {
          attempt: event.attempt,
          subtasks: [],
          criteria: [],
        };
        report.attempts.push(currentAttempt);
        break;

      case "subtask_started":
        subtaskNames.set(event.index, event.name);
        subtaskStartTimes.set(`${event.attempt}:${event.index}`, ts);
        break;

      case "subtask_completed": {
        if (!currentAttempt) break;
        const name = subtaskNames.get(event.index) ?? `Sub-task ${event.index + 1}`;
        const startTime = subtaskStartTimes.get(`${event.attempt}:${event.index}`);
        const durationMs = startTime ? ts.getTime() - startTime.getTime() : undefined;
        currentAttempt.subtasks.push({
          index: event.index,
          name,
          status: event.status,
          durationMs,
          failureContext: event.failureContext,
        });
        break;
      }

      case "eval_started":
        if (currentAttempt) currentAttempt.evalCommand = event.command;
        break;

      case "criteria_checked":
        if (currentAttempt) {
          for (const [criterion, passed] of Object.entries(event.results)) {
            currentAttempt.criteria.push({ criterion, passed: Boolean(passed) });
          }
        }
        break;

      case "goal_completed":
        report.finalSuccess = event.success;
        report.finalAttempts = event.attempts;
        if (startTs) {
          report.durationMs = ts.getTime() - startTs.getTime();
        }
        break;

      case "goal_error":
        report.error = event.message;
        break;

      default:
        // plan_review_started, eval_completed — no action needed for report
        break;
    }
  }

  return report;
}

/**
 * Format a RunReport as a chalk-colored string for terminal display.
 * Safe to call in non-TTY contexts — chalk auto-detects color support.
 */
export function formatRunReport(report: RunReport): string {
  const lines: string[] = [];

  const specName = basename(report.specFile);
  lines.push(chalk.bold(`Goal: ${specName}`));

  if (report.error) {
    lines.push(chalk.red(`\nError: ${report.error}`));
    return lines.join("\n");
  }

  if (report.challenged) {
    const verdict = report.challengeVerdict ?? "CHALLENGED";
    lines.push("");
    lines.push(`  ${chalk.yellow("⚠")}  Pre-execution review: ${chalk.yellow(verdict)}`);
    lines.push(chalk.dim("  Run was halted before execution."));
    return lines.join("\n");
  }

  for (const attempt of report.attempts) {
    lines.push(`\n  ${chalk.dim(`Attempt ${attempt.attempt}/${report.maxAttempts}`)}`);

    for (const subtask of attempt.subtasks) {
      const icon = subtask.status === "passed"
        ? chalk.green("✓")
        : chalk.red("✗");
      const dur = subtask.durationMs !== undefined
        ? chalk.dim(` (${formatDuration(subtask.durationMs)})`)
        : "";
      lines.push(`    ${icon} ${subtask.name}${dur}`);
    }

    if (attempt.evalCommand) {
      lines.push(chalk.dim(`\n  Eval: ${attempt.evalCommand}`));
    }

    if (attempt.criteria.length > 0) {
      lines.push("\n  Criteria:");
      for (const c of attempt.criteria) {
        const icon = c.passed ? chalk.green("✓") : chalk.red("✗");
        lines.push(`    ${icon} ${c.criterion}`);
      }
    }
  }

  const dur = report.durationMs !== undefined
    ? chalk.dim(` — ${formatDuration(report.durationMs)}`)
    : "";
  const attemptsStr = `${report.finalAttempts} attempt${report.finalAttempts !== 1 ? "s" : ""}`;

  if (report.finalSuccess) {
    lines.push(`\n${chalk.green("✓")} ${chalk.bold("Goal complete")} — ${attemptsStr}${dur}`);
  } else if (report.finalAttempts > 0) {
    lines.push(`\n${chalk.red("✗")} ${chalk.bold("Goal failed")} — ${attemptsStr}${dur}`);
  } else {
    lines.push(`\n${chalk.dim("Goal did not run.")}`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}
