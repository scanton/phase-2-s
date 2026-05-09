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

import { exec } from "node:child_process";
import { promisify } from "node:util";
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
  options: {
    model?: string;
    cwd?: string;
    _provider?: import("../providers/types.js").Provider;
    /** Test-only: inject a synchronously-resolving context builder to avoid
     *  real subprocess I/O while fake timers are active (avoids macrotask/fake-timer race). */
    _buildContext?: (cwd: string) => Promise<string>;
  } = {},
): Promise<ConductorGenResult> {
  const baseCwd = options.cwd ?? process.cwd();
  const codebaseContext = await (options._buildContext ?? buildConductorContext)(baseCwd);

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
  let spec = await streamSpec(provider, [{ role: "user", content: prompt }], model);
  if (spec === null) return { specPath: "", specContent: "" };

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

    const retrySpec = await streamSpec(provider, [{ role: "user", content: retryPrompt }], model);
    if (retrySpec === null) return { specPath: "", specContent: "" };

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

/**
 * Stream a single LLM call with AbortController timeout (D5).
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
