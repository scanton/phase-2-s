/**
 * phase2s lint — validate a 5-pillar spec before running it.
 *
 * Runs a set of structural checks on a parsed spec and reports errors (blocking)
 * and warnings (advisory). Designed to catch broken specs before the 20-minute
 * dark-factory run begins.
 *
 * Pure check functions are exported for testing. runLint() handles all IO.
 * Exit code reflects result: 0 = no errors (warnings OK), 1 = one or more errors.
 */

import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import chalk from "chalk";
import { parseSpec } from "../core/spec-parser.js";
import type { Spec } from "../core/spec-parser.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LintIssue {
  severity: "error" | "warn";
  message: string;
  fix?: string;
}

export interface LintResult {
  ok: boolean; // true when there are zero errors (warnings do not affect ok)
  issues: LintIssue[];
}

// ---------------------------------------------------------------------------
// Pure validation (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Validate a parsed Spec for structural completeness.
 * Returns all issues found — does not fail fast.
 */
export function lintSpec(spec: Spec): LintResult {
  const issues: LintIssue[] = [];

  // ── Errors (blocking — goal executor will fail or produce wrong results) ──

  if (!spec.title || spec.title === "Untitled Spec") {
    issues.push({
      severity: "error",
      message: "spec has no title",
      fix: "Add a # Title line at the top of the spec file",
    });
  }

  if (!spec.problemStatement || spec.problemStatement.trim() === "") {
    issues.push({
      severity: "error",
      message: "## Problem Statement section is empty",
      fix: "Describe what problem this spec solves",
    });
  }

  if (spec.decomposition.length === 0) {
    issues.push({
      severity: "error",
      message: "## Decomposition section has no sub-tasks",
      fix: "Add at least one sub-task with ### Name, Input, Output, and Success Criteria",
    });
  }

  if (spec.acceptanceCriteria.length === 0) {
    issues.push({
      severity: "error",
      message: "## Acceptance Criteria section is empty",
      fix: "Add at least one criterion — the goal executor checks these to determine success",
    });
  }

  // ── Warnings (advisory — goal executor will run but may produce poor results) ──

  if (spec.evalCommand === "npm test") {
    issues.push({
      severity: "warn",
      message: 'evalCommand is "npm test" (the default) — confirm this is correct for your project',
      fix: 'Add "eval: <your-test-command>" to the spec if your project uses a different test runner',
    });
  }

  if (spec.decomposition.length > 8) {
    issues.push({
      severity: "warn",
      message: `spec has ${spec.decomposition.length} sub-tasks — large specs are unreliable`,
      fix: "Consider breaking this into multiple smaller specs (2-3 sub-tasks each) and running them sequentially",
    });
  }

  for (const subtask of spec.decomposition) {
    if (!subtask.successCriteria || subtask.successCriteria.trim() === "") {
      issues.push({
        severity: "warn",
        message: `sub-task "${subtask.name || "<unnamed>"}" has no Success Criteria`,
        fix: "Add a Success Criteria line so satori knows when the sub-task is done",
      });
    }
    if (!subtask.name || subtask.name.trim() === "") {
      issues.push({
        severity: "warn",
        message: "a sub-task has an empty name",
        fix: "Give each sub-task a descriptive name under ### heading",
      });
    }
  }

  const errorCount = issues.filter((i) => i.severity === "error").length;
  return { ok: errorCount === 0, issues };
}

// ---------------------------------------------------------------------------
// runLint — entry point
// ---------------------------------------------------------------------------

/**
 * Read a spec file, parse it, run lintSpec(), and print results.
 * Returns true if there are no errors (may have warnings).
 * Returns false if any errors were found.
 */
export async function runLint(specFilePath: string): Promise<boolean> {
  const absPath = resolve(specFilePath);

  if (!existsSync(absPath)) {
    console.error(chalk.red(`  ✗  File not found: ${specFilePath}`));
    return false;
  }

  let content: string;
  try {
    content = readFileSync(absPath, "utf8");
  } catch (err) {
    console.error(chalk.red(`  ✗  Could not read ${specFilePath}: ${(err as Error).message}`));
    return false;
  }

  const spec = parseSpec(content);
  const result = lintSpec(spec);

  // Check evalCommand's first word is on PATH.
  // Skip when evalCommand equals the default ("npm test") — most dev machines
  // have npm, and the existing "npm test (default)" warning already covers that.
  // Guard against empty evalBin (parseSpec always returns a default, but be safe).
  const evalBin = spec.evalCommand.split(/\s+/)[0];
  if (evalBin && spec.evalCommand !== "npm test") {
    const binOnPath = await new Promise<boolean>((resolve) => {
      execFile("which", [evalBin], { shell: false }, (err) => resolve(!err));
    });
    if (!binOnPath) {
      result.issues.push({
        severity: "warn",
        message: `evalCommand uses "${evalBin}" which was not found on PATH (note: shell virtualenv activation is not applied here — run \`which ${evalBin}\` in your shell to verify)`,
        fix: `Install ${evalBin} or update evalCommand to a command that is available on PATH`,
      });
      // ok is unchanged — PATH warnings are advisory only, not blocking errors
    }
  }

  const errors = result.issues.filter((i) => i.severity === "error");
  const warns = result.issues.filter((i) => i.severity === "warn");

  console.log(chalk.bold(`\n  Linting ${specFilePath}\n`));
  console.log(chalk.dim(`  Title:    ${spec.title}`));
  console.log(chalk.dim(`  Sub-tasks: ${spec.decomposition.length}`));
  console.log(chalk.dim(`  Criteria:  ${spec.acceptanceCriteria.length}`));
  console.log(chalk.dim(`  Eval:      ${spec.evalCommand}`));
  console.log("");

  if (result.issues.length === 0) {
    console.log(chalk.green("  ✓  Spec looks good. Ready to run phase2s goal."));
    console.log("");
    return true;
  }

  for (const issue of result.issues) {
    if (issue.severity === "error") {
      console.log(chalk.red(`  ✗  ${issue.message}`));
    } else {
      console.log(chalk.yellow(`  ⚠  ${issue.message}`));
    }
    if (issue.fix) {
      console.log(chalk.dim(`       ${issue.fix}`));
    }
  }

  console.log("");
  if (errors.length > 0) {
    const plural = errors.length === 1 ? "error" : "errors";
    const warnNote = warns.length > 0 ? `, ${warns.length} warning${warns.length === 1 ? "" : "s"}` : "";
    console.log(chalk.red(`  ${errors.length} ${plural}${warnNote} found. Fix errors before running phase2s goal.`));
  } else {
    console.log(chalk.yellow(`  ${warns.length} warning${warns.length === 1 ? "" : "s"} — spec is runnable but review the notes above.`));
  }
  console.log("");

  return result.ok;
}
