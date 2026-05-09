/**
 * Phase2S Conductor — spec generator for the multi-agent orchestrator.
 *
 * conductorGenSpec() takes a natural-language goal and produces a role-annotated
 * 5-pillar spec that the existing orchestrator can execute.  The spec is
 * validated by lintSpec() and retried once on failure before being written to
 * .phase2s/specs/<slug>-<ts>.md.
 *
 * buildConductorContext() extracts lightweight codebase context (branch, recent
 * commits, diff stat) to help the LLM choose sensible file names and understand
 * the project structure.  Output is capped at 2000 bytes (D9) so the conductor
 * prompt stays within safe token bounds.
 */

import { execSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { createProvider } from "../providers/index.js";
import { loadConfig, type Config } from "../core/config.js";
import { parseSpec } from "../core/spec-parser.js";
import { lintSpec } from "./lint.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum bytes of codebase context injected into the conductor prompt (D9). */
const CONTEXT_MAX_BYTES = 2000;

/** AbortController timeout for LLM spec-generation calls, in ms (D5). */
const STREAM_TIMEOUT_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Conductor prompt template
// ---------------------------------------------------------------------------

export const CONDUCTOR_PROMPT = `You are a software architect decomposing a goal
into a role-annotated execution plan for a multi-agent coding system.

GOAL: {goal}
CODEBASE: {codebaseContext}

Produce a Phase2S spec in this EXACT format. Use the EXACT headings shown — they
are parsed programmatically so any deviation breaks downstream tooling.

# {Spec title derived from goal}

## Problem Statement
{One paragraph clearly describing the goal and why it matters.}

## Decomposition

### Sub-task 1: {Architect subtask title}
**Role:** architect
- **Files:** arch-plan.md
- **Input:** {goal string and codebase context}
- **Output:** arch-plan.md with implementation blueprint
- **Success criteria:** arch-plan.md exists and contains a complete implementation plan

### Sub-task 2: {Core implementer title}
**Role:** implementer
- **Files:** {main source files this touches, comma-separated}
- **Input:** arch-plan.md
- **Output:** {implemented files}
- **Success criteria:** {specific, testable success condition}

### Sub-task N: {Reviewer title}
**Role:** reviewer
- **Files:** arch-plan.md, {main files}
- **Input:** all implemented files and arch-plan.md
- **Output:** review report or inline comments
- **Success criteria:** code review complete, no critical issues found

## Eval Command
{Single shell command to verify the work, e.g. "npm test" or "bun test"}

## Acceptance Criteria
- {Primary acceptance criterion}
- All subtask success criteria met
- Eval command exits 0

RULES:
- Sub-task headings MUST use "### Sub-task N: Title" format exactly
- **Role:** must be one of: architect, implementer, tester, reviewer
- Architect sub-task must come FIRST (others depend on arch-plan.md)
- Tester and reviewer sub-tasks come LAST
- 3-6 sub-tasks total — scale to goal complexity, don't pad
- File names in **Files:** must be real relative paths or planning artifacts
- Do not invent sub-tasks for work that is already done or clearly out of scope
`;

// ---------------------------------------------------------------------------
// buildConductorContext — local helper (D7)
// ---------------------------------------------------------------------------

/**
 * Build a lightweight codebase context string for the conductor prompt.
 *
 * Extracts git branch, recent commit log, and diff stat.  All git calls are
 * wrapped in try/catch so failure is silent in non-git directories.  Output
 * is capped at CONTEXT_MAX_BYTES (D9).
 *
 * @param cwd  Working directory for git commands (defaults to process.cwd()).
 *             Must match the user's project directory so git context reflects
 *             the right repo, not the phase2s install location.
 */
export async function buildConductorContext(cwd?: string): Promise<string> {
  let branch = "unknown";
  let gitLog = "";
  let gitDiff = "";

  const execOpts = { encoding: "utf-8" as const, cwd: cwd ?? process.cwd() };

  try {
    branch = execSync("git branch --show-current", execOpts).trim();
  } catch {
    // not a git repo or git unavailable
  }
  try {
    gitLog = execSync("git log --oneline -5", execOpts).trim();
  } catch {
    // not a git repo or no commits
  }
  try {
    gitDiff = execSync("git diff --stat HEAD", execOpts).trim();
  } catch {
    // nothing staged or no HEAD
  }

  const raw = [
    `Branch: ${branch}`,
    "",
    "Recent commits:",
    gitLog || "(no commits)",
    "",
    "Changed files:",
    gitDiff || "(no changes)",
  ].join("\n");

  // Cap at CONTEXT_MAX_BYTES (D9)
  if (raw.length <= CONTEXT_MAX_BYTES) return raw;
  return raw.slice(0, CONTEXT_MAX_BYTES) + "\n... (truncated)";
}

// ---------------------------------------------------------------------------
// conductorGenSpec
// ---------------------------------------------------------------------------

export interface ConductorGenResult {
  /** Absolute path to the saved spec file, or '' on failure. */
  specPath: string;
  /** Raw spec markdown content, or '' on failure. */
  specContent: string;
}

/**
 * Generate a role-annotated 5-pillar spec from a natural-language goal.
 *
 * Flow:
 *   1. Build codebase context snapshot (git log + diff stat, 2000-byte cap)
 *   2. Call LLM with CONDUCTOR_PROMPT via provider.chatStream (5-min timeout)
 *   3. Validate with lintSpec() — retry once on failure (D4)
 *   4. Save to .phase2s/specs/<slug>-<ts>.md
 *
 * Returns { specPath: '', specContent: '' } on any failure so callers
 * can check specPath === '' without catching (execute-try-catch-contract).
 *
 * @param options._provider  Optional provider override — used in tests to inject
 *                           a mock without module-level mocking. Production callers
 *                           leave this unset and createProvider(config) is used.
 */
export async function conductorGenSpec(
  goal: string,
  config: Config,
  options: { model?: string; cwd?: string; _provider?: import("../providers/types.js").Provider } = {},
): Promise<ConductorGenResult> {
  const baseCwd = options.cwd ?? process.cwd();
  const codebaseContext = await buildConductorContext(baseCwd);

  // Safe single-pass template substitution — avoids recursive expansion if the
  // goal or codebaseContext happens to contain a placeholder like {codebaseContext}.
  const substitutions: Record<string, string> = {
    "{goal}": goal,
    "{codebaseContext}": codebaseContext,
  };
  const prompt = CONDUCTOR_PROMPT.replace(
    /\{goal\}|\{codebaseContext\}/g,
    (match) => substitutions[match] ?? match,
  );

  const model = options.model ?? config.smart_model ?? config.model;
  const provider = options._provider ?? createProvider(config);

  // First LLM call with AbortController timeout (D5)
  let spec = "";
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), STREAM_TIMEOUT_MS);

  try {
    for await (const event of provider.chatStream(
      [{ role: "user", content: prompt }],
      [],
      { model, signal: controller.signal },
    )) {
      if (event.type === "text") spec += event.content;
      else if (event.type === "error") throw new Error(event.error);
    }
  } catch {
    // Timeout, network error, or provider error — return empty sentinel
    return { specPath: "", specContent: "" };
  } finally {
    clearTimeout(timeoutId);
  }

  // Validate — retry once on lint failure (D4)
  const firstLint = lintSpec(parseSpec(spec));
  if (!firstLint.ok) {
    const errorList = firstLint.issues
      .filter((i) => i.severity === "error")
      .map((i) => `- ${i.message}`)
      .join("\n");

    const retryPrompt =
      `The spec you generated had the following errors:\n${errorList}\n\n` +
      `Please regenerate the complete spec fixing all errors.\n\n` +
      prompt;

    let retrySpec = "";
    const retryController = new AbortController();
    const retryTimeoutId = setTimeout(() => retryController.abort(), STREAM_TIMEOUT_MS);

    try {
      for await (const event of provider.chatStream(
        [{ role: "user", content: retryPrompt }],
        [],
        { model, signal: retryController.signal },
      )) {
        if (event.type === "text") retrySpec += event.content;
        else if (event.type === "error") throw new Error(event.error);
      }
    } catch {
      return { specPath: "", specContent: "" };
    } finally {
      clearTimeout(retryTimeoutId);
    }

    const retryLint = lintSpec(parseSpec(retrySpec));
    if (!retryLint.ok) {
      // Both attempts produced invalid specs — return empty sentinel (D4)
      return { specPath: "", specContent: "" };
    }

    spec = retrySpec;
  }

  // Save spec to .phase2s/specs/
  const slug = slugify(goal.slice(0, 40));
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const specPath = join(baseCwd, ".phase2s", "specs", `${slug}-${ts}.md`);

  try {
    await mkdir(dirname(specPath), { recursive: true });
    await writeFile(specPath, spec, "utf8");
  } catch (err) {
    // Log the specific error so disk-full or permission issues aren't mislabeled as LLM failures
    console.error(`[conductorGenSpec] Failed to write spec file: ${(err as Error).message}`);
    return { specPath: "", specContent: "" };
  }

  return { specPath, specContent: spec };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Slugify a string for use in filenames. */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "conduct";
}

// ---------------------------------------------------------------------------
// Convenience loader — loads config then calls conductorGenSpec.
// Used by the MCP handler which has no pre-loaded config.
// ---------------------------------------------------------------------------

export async function conductorGenSpecFromGoal(
  goal: string,
  options: { model?: string; cwd?: string } = {},
): Promise<ConductorGenResult> {
  const config = await loadConfig();
  return conductorGenSpec(goal, config, options);
}
