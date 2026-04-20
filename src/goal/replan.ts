/**
 * Replan agent.
 *
 * After a parallel goal run fails acceptance criteria, `replanFailingSubtasks`
 * calls a single-shot LLM agent to produce revised sub-task descriptions
 * grounded in what actually failed. The caller (goal.ts retry loop) uses
 * the result to build `revisedSubtasks` and `subsetToRun` for the next
 * `executeParallel` attempt.
 *
 * Design decisions:
 * - Uses `new Agent({ config, tools: new ToolRegistry() })` with `maxTurns=1`
 *   — spec repair, not a general assistant. Empty registry prevents
 *   file-system access.
 *   No learnings injected (project conventions are for developer agents, not
 *   judge agents).
 * - Strips markdown code fences before JSON.parse — models frequently wrap
 *   JSON in ```json blocks.
 * - Validates returned sub-task names against the original list. Any name
 *   not in the original list is dropped with a dim warning (hallucination guard).
 * - On JSON parse failure returns [] so the caller retries with original
 *   descriptions (degraded, not broken).
 */

import chalk from "chalk";
import { Agent } from "../core/agent.js";
import { ToolRegistry } from "../tools/registry.js";
import type { Config } from "../core/config.js";
import type { SubTask } from "../core/spec-parser.js";

export interface RevisedSubtask {
  /** Must match an existing sub-task name exactly. */
  name: string;
  /** Replacement description for the retry run. */
  description: string;
}

const EVAL_OUTPUT_MAX = 4096;
const FENCE_RE = /```(?:json)?\s*([\s\S]*?)```/;

/**
 * Call a single-shot replan agent to produce revised descriptions for
 * sub-tasks that are responsible for failing acceptance criteria.
 *
 * @param failingCriteria - Acceptance criteria strings that failed (from checkCriteria).
 * @param evalOutput      - Raw eval command output (truncated to EVAL_OUTPUT_MAX chars).
 * @param allSubtasks     - Full list of sub-tasks from the spec.
 * @param config          - Phase2S config (provider, model, etc.).
 * @returns Array of revised sub-tasks. Empty array on parse failure or when
 *          the agent produces no actionable revisions.
 */
export async function replanFailingSubtasks(
  failingCriteria: string[],
  evalOutput: string,
  allSubtasks: SubTask[],
  config: Config,
): Promise<RevisedSubtask[]> {
  // Capture the TAIL of eval output — test failures and assertion errors appear
  // at the end, not the beginning. Slicing from the head captures setup boilerplate.
  const truncatedEval = evalOutput.slice(-EVAL_OUTPUT_MAX);
  const subtaskCount = allSubtasks.length;

  process.stderr.write(
    chalk.dim(`Analyzing failures... revising up to ${subtaskCount} sub-tasks.\n`),
  );

  const prompt = buildReplanPrompt(failingCriteria, truncatedEval, allSubtasks);

  // Pass maxTurns: 1 via a modified config — spec repair agent never needs more
  // than one turn. AgentOptions does not expose maxTurns directly.
  // Empty ToolRegistry — prevents the judge agent from touching the file system.
  const agent = new Agent({ config: { ...config, maxTurns: 1 }, tools: new ToolRegistry() });

  let raw: string;
  try {
    raw = await agent.run(prompt);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(chalk.dim(`  Replan agent error: ${msg} — retrying with original descriptions.\n`));
    return [];
  }

  return parseReplanResponse(raw, allSubtasks);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildReplanPrompt(
  failingCriteria: string[],
  evalOutput: string,
  allSubtasks: SubTask[],
): string {
  const criteriaList = failingCriteria.map((c) => `  - ${c}`).join("\n");
  const subtaskList = allSubtasks
    .map((s) => `  - name: "${s.name}"\n    description: "${s.input} → ${s.output} (success: ${s.successCriteria})"`)
    .join("\n");

  return `You are a spec repair agent. A parallel build just ran and these acceptance criteria failed:
${criteriaList}

This is the eval command output (truncated to ${EVAL_OUTPUT_MAX} chars):
${evalOutput}

These are all the sub-tasks from the spec:
${subtaskList}

Based on the eval output, determine which sub-tasks are most likely responsible for the failing criteria. For each such sub-task, write a revised description that addresses the failure. Be specific about what went wrong and what the implementer should do differently.

Rules:
- Only revise sub-tasks that are clearly implicated by the eval output and failing criteria.
- Do not change sub-tasks that appear to be working correctly.
- Use the exact sub-task name from the list above.
- Each revised description should be a complete, actionable replacement for the original.

Output as JSON only — no explanation, no markdown prose:
{ "revised": [{ "name": "exact-subtask-name", "description": "revised description here" }] }`;
}

/**
 * Parse the replan agent's response. Strips markdown fences, validates
 * sub-task names against the original list, and drops hallucinated entries.
 */
function parseReplanResponse(raw: string, allSubtasks: SubTask[]): RevisedSubtask[] {
  const originalNames = new Set(allSubtasks.map((s) => s.name));

  // Strip markdown code fences if present
  let jsonText = raw.trim();
  const fenceMatch = FENCE_RE.exec(jsonText);
  if (fenceMatch) {
    jsonText = fenceMatch[1].trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    process.stderr.write(
      chalk.dim(`  Replan agent returned unparseable JSON — retrying with original descriptions.\n`),
    );
    return [];
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as Record<string, unknown>).revised)
  ) {
    process.stderr.write(
      chalk.dim(`  Replan agent response missing "revised" array — retrying with original descriptions.\n`),
    );
    return [];
  }

  const candidates = (parsed as { revised: unknown[] }).revised;
  const result: RevisedSubtask[] = [];

  for (const entry of candidates) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof (entry as Record<string, unknown>).name !== "string" ||
      typeof (entry as Record<string, unknown>).description !== "string"
    ) {
      continue;
    }

    const { name, description } = entry as { name: string; description: string };

    if (!originalNames.has(name)) {
      process.stderr.write(
        chalk.dim(`  Replan: dropped hallucinated sub-task name "${name}" (not in original spec).\n`),
      );
      continue;
    }

    result.push({ name, description });
  }

  return result;
}
