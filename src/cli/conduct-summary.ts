/**
 * phase2s conduct-summary — post-run structured summary for `conduct` runs.
 *
 * Renders a table of per-subtask results after a conductor orchestrator run.
 * Gated on !options.quiet so CI/MCP callers are unaffected.
 *
 * Columns: Subtask | Role | Status
 * ("Tries" column omitted — the orchestrator path does not track per-subtask retry counts.)
 */

import chalk from "chalk";
import type { GoalResult, OrchestratorSubtaskSummary } from "./goal.js";

// ---------------------------------------------------------------------------
// formatDuration
// ---------------------------------------------------------------------------

/**
 * Format a millisecond duration as a human-readable string.
 *   formatDuration(0)       → "0s"
 *   formatDuration(1500)    → "1s"
 *   formatDuration(90000)   → "1m 30s"
 *   formatDuration(3723000) → "1h 2m 3s"
 */
export function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

// ---------------------------------------------------------------------------
// renderConductSummary
// ---------------------------------------------------------------------------

/**
 * Render the structured post-run summary table for a conductor run.
 *
 * Uses result.subtaskResults (inserted in topological order by goal.ts)
 * for row data. Falls back to a one-liner when subtaskResults is absent or
 * empty (e.g. non-orchestrator fallback, or run errored before checkpoint).
 *
 * @param result   GoalResult returned by runGoal()
 * @param specPath Absolute path to the spec file used for the run
 * @param goal     Original natural-language goal string
 * @param options  { quiet } — suppress all output when true
 */
export function renderConductSummary(
  result: GoalResult,
  specPath: string,
  goal: string,
  options: { quiet?: boolean } = {},
): void {
  if (options.quiet) return;

  const rows = Object.values(result.subtaskResults ?? {});
  const width = Math.min(process.stdout.columns ?? 72, 80);
  const sep = chalk.dim("─".repeat(width));

  console.log();
  console.log(sep);

  // Header — truncate goal to fit width (minus 2 for padding)
  const goalLabel = ` Conductor run: ${goal}`;
  console.log(chalk.dim(goalLabel.length > width - 1 ? goalLabel.slice(0, width - 4) + "…" : goalLabel));
  console.log(sep);

  if (rows.length === 0) {
    // Fallback: no per-subtask data (non-orchestrator run or early error)
    const statusIcon = result.success ? chalk.green("✓") : chalk.red("✗");
    const duration = formatDuration(result.durationMs);
    console.log(` ${statusIcon} ${result.summary}  (${duration})`);
  } else {
    // Column fixed widths
    const ROLE_W  = 12;
    const STATUS_W = 9;
    const PADDING  = 4; // spaces between columns + borders
    const nameW = Math.max(20, width - ROLE_W - STATUS_W - PADDING);

    // Header row
    console.log(chalk.dim(
      ` ${"Subtask".padEnd(nameW)} ${"Role".padEnd(ROLE_W)} Status`,
    ));

    // Data rows
    let passed = 0, failed = 0, skipped = 0;
    for (const row of rows) {
      const name = row.title.length > nameW
        ? row.title.slice(0, nameW - 1) + "…"
        : row.title.padEnd(nameW);
      const role = row.role.slice(0, ROLE_W).padEnd(ROLE_W);

      let statusStr: string;
      if (row.status === "passed") {
        statusStr = chalk.green("✓ passed");
        passed++;
      } else if (row.status === "failed") {
        statusStr = chalk.red("✗ failed");
        failed++;
      } else {
        statusStr = chalk.yellow("⊘ skipped");
        skipped++;
      }

      console.log(` ${name} ${role} ${statusStr}`);
    }

    // Footer
    console.log(sep);
    const parts: string[] = [];
    if (passed > 0)  parts.push(chalk.green(`${passed} passed`));
    if (failed > 0)  parts.push(chalk.red(`${failed} failed`));
    if (skipped > 0) parts.push(chalk.yellow(`${skipped} skipped`));
    const duration = formatDuration(result.durationMs);
    console.log(` Result:   ${parts.join(", ")}  (${duration})`);
  }

  // Spec path (relative if possible)
  const displayPath = specPath.startsWith(process.cwd())
    ? specPath.slice(process.cwd().length + 1)
    : specPath;
  console.log(chalk.dim(` Spec:     ${displayPath}`));
  console.log(chalk.dim(` Re-run:   phase2s goal ${displayPath} --orchestrator`));
  console.log(sep);
  console.log();
}
