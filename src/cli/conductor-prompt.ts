/**
 * Phase2S Conductor — spec generator for the multi-agent orchestrator.
 *
 * conductorGenSpec() takes a natural-language goal and produces a role-annotated
 * 5-pillar spec that the existing orchestrator can execute.  The spec is
 * validated by lintSpec() and retried once on failure before being written to
 * .phase2s/specs/<slug>-<ts>-<hex>.md.
 *
 * buildConductorContext() extracts lightweight codebase context (branch, recent
 * commits, diff stat) to help the LLM choose sensible file names and understand
 * the project structure.  Output is capped at 2000 bytes (D9) so the conductor
 * prompt stays within safe token bounds.
 *
 * Sprint 87 hardening additions:
 *   - GOAL_MAX_CHARS (4000): goals longer than this are truncated with a warning
 *     before the LLM call.  Applied inside conductorGenSpec() so both the CLI
 *     and MCP entrypoints are protected (D4).
 *   - Tier alias resolution: "--model fast/smart" is resolved to the configured
 *     fast_model/smart_model before the provider call (D5).
 *   - _randomSuffix option: injectable fn for deterministic tests; production
 *     default is randomBytes(4).toString("hex") (C).
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { createProvider } from "../providers/index.js";
import type { Config } from "../core/config.js";
import type { Message } from "../providers/types.js";
import { parseSpec } from "../core/spec-parser.js";
import { lintSpec } from "./lint.js";

const execAsync = promisify(exec);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum bytes of codebase context injected into the conductor prompt (D9). */
const CONTEXT_MAX_BYTES = 2000;

/** AbortController timeout for LLM spec-generation calls, in ms (D5). */
const STREAM_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Maximum characters accepted in the goal string (A / D4).
 *
 * Goals exceeding this are truncated with a console.warn before being sent to
 * the LLM.  Applied inside conductorGenSpec() so both the CLI path (runConduct)
 * and the MCP path (handler.ts) are protected.
 *
 * Exported so tests can reference the limit without hardcoding 4000.
 */
export const GOAL_MAX_CHARS = 4000;

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
  const execCwd = cwd ?? process.cwd();
  const opts = { cwd: execCwd, timeout: 5000 };

  const [branchResult, logResult, diffResult] = await Promise.allSettled([
    execAsync("git branch --show-current", opts),
    execAsync("git log --oneline -5", opts),
    execAsync("git diff --stat HEAD", opts),
  ]);

  const branch = branchResult.status === "fulfilled" ? branchResult.value.stdout.trim() : "unknown";
  const gitLog = logResult.status === "fulfilled" ? logResult.value.stdout.trim() : "";
  const gitDiff = diffResult.status === "fulfilled" ? diffResult.value.stdout.trim() : "";

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
 *   1. Truncate goal to GOAL_MAX_CHARS if needed (warn; protects CLI + MCP, D4)
 *   2. Resolve "fast"/"smart" tier aliases to configured model names (D5)
 *   3. Build codebase context snapshot (git log + diff stat, 2000-byte cap)
 *   4. Call LLM with CONDUCTOR_PROMPT via provider.chatStream (5-min timeout)
 *   5. Validate with lintSpec() — retry once on failure (D4-orig)
 *   6. Save to .phase2s/specs/<slug>-<ts>-<hex>.md (C: 4-byte random suffix)
 *
 * Returns { specPath: '', specContent: '' } on any failure so callers
 * can check specPath === '' without catching (execute-try-catch-contract).
 *
 * @param options._provider      Optional provider override — used in tests to inject
 *                               a mock without module-level mocking.
 * @param options._buildContext  Test-only: inject a synchronously-resolving context
 *                               builder to avoid real subprocess I/O while fake timers
 *                               are active (avoids macrotask/fake-timer race).
 * @param options._randomSuffix  Test-only: inject a deterministic suffix fn so tests
 *                               can assert on specPath without randomness.
 *                               Production callers leave this unset.
 */
export async function conductorGenSpec(
  goal: string,
  config: Config,
  options: {
    model?: string;
    cwd?: string;
    _provider?: import("../providers/types.js").Provider;
    /** Test-only: inject a synchronously-resolving context builder to avoid
     *  real subprocess I/O while fake timers are active (avoids macrotask/fake-timer race). */
    _buildContext?: (cwd: string) => Promise<string>;
    /** Test-only: inject a deterministic random suffix function.
     *  Default: () => randomBytes(4).toString("hex")  */
    _randomSuffix?: () => string;
  } = {},
): Promise<ConductorGenResult> {
  // --- A / D4: Goal length cap — applied here so both CLI and MCP are protected ---
  let effectiveGoal = goal;
  if (goal.length > GOAL_MAX_CHARS) {
    console.warn(
      `[phase2s] Goal truncated from ${goal.length} to ${GOAL_MAX_CHARS} characters. ` +
      `Use a shorter goal to avoid this warning.`,
    );
    effectiveGoal = goal.slice(0, GOAL_MAX_CHARS);
  }

  const baseCwd = options.cwd ?? process.cwd();
  const codebaseContext = await (options._buildContext ?? buildConductorContext)(baseCwd);

  // Safe single-pass template substitution — avoids recursive expansion if the
  // goal or codebaseContext happens to contain a placeholder like {codebaseContext}.
  const substitutions: Record<string, string> = {
    "{goal}": effectiveGoal,
    "{codebaseContext}": codebaseContext,
  };
  const prompt = CONDUCTOR_PROMPT.replace(
    /\{goal\}|\{codebaseContext\}/g,
    (match) => substitutions[match] ?? match,
  );

  // --- D5: Resolve tier aliases before passing to provider ---
  let model = options.model ?? config.smart_model ?? config.model;
  if (typeof model === "string") {
    if (model.toLowerCase() === "fast") model = config.fast_model ?? model;
    else if (model.toLowerCase() === "smart") model = config.smart_model ?? model;
  }

  const provider = options._provider ?? createProvider(config);

  // First LLM call with AbortController timeout (D5-orig)
  let spec = await streamSpec(provider, [{ role: "user", content: prompt }], model);
  if (spec === null) return { specPath: "", specContent: "" };

  // Validate — retry once on lint failure (D4-orig)
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

    const retrySpec = await streamSpec(provider, [{ role: "user", content: retryPrompt }], model);
    if (retrySpec === null) return { specPath: "", specContent: "" };

    const retryLint = lintSpec(parseSpec(retrySpec));
    if (!retryLint.ok) {
      // Both attempts produced invalid specs — return empty sentinel (D4-orig)
      return { specPath: "", specContent: "" };
    }

    spec = retrySpec;
  }

  // --- C: Save spec with 4-byte random hex suffix to reduce filename collision risk ---
  const slug = slugify(effectiveGoal.slice(0, 40));
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const getSuffix = options._randomSuffix ?? (() => randomBytes(4).toString("hex"));
  let suffix: string;
  try {
    suffix = getSuffix();
  } catch {
    suffix = randomBytes(4).toString("hex");
  }
  const specPath = join(baseCwd, ".phase2s", "specs", `${slug}-${ts}-${suffix}.md`);

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

/**
 * Stream a single LLM call with AbortController timeout (D5-orig).
 *
 * Returns the accumulated text on success, or null on any error
 * (timeout, network failure, provider error).  Using null-as-sentinel
 * means callers never have to catch — the execute-try-catch-contract
 * stays in one place.
 */
async function streamSpec(
  provider: import("../providers/types.js").Provider,
  messages: Message[],
  model: string,
): Promise<string | null> {
  let text = "";
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), STREAM_TIMEOUT_MS);
  try {
    for await (const event of provider.chatStream(messages, [], { model, signal: controller.signal })) {
      if (event.type === "text") text += event.content;
      else if (event.type === "error") throw new Error(event.error);
    }
    return text;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Slugify a string for use in filenames. */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "conduct";
}
