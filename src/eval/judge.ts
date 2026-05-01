/**
 * Spec eval judge — diff-aware coverage map generator.
 *
 * Reads a spec file's acceptance criteria + a git diff and produces a
 * coverage map: which criteria are met, partial, or missed, with per-criterion
 * evidence citations and a derived 0-10 score.
 *
 * Score formula: (met×1.0 + partial×0.5) / total × 10
 * Guard: total === 0 → score: null (no criteria extractable)
 *
 * Error contract: judgeRun() never throws. On any failure, returns:
 *   { score: null, verdict: "Judge failed: <reason>", criteria: [], diffStats: ... }
 */

import { readFileSync } from "node:fs";
import { Agent } from "../core/agent.js";
import type { Config } from "../core/config.js";
import type { CriterionSpec, RunnerResult } from "./types.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type CriterionStatus = "met" | "partial" | "missed";

export interface CriterionResult {
  text: string;
  status: CriterionStatus;
  evidence: string;      // diff hunk reference or "(none found in diff)"
  confidence: number;    // 0–1
}

export interface JudgeResult {
  score: number | null;  // null when no criteria extractable or on failure
  verdict: string;
  criteria: CriterionResult[];
  diffStats?: { filesChanged: number; insertions: number; deletions: number };
  responseStats?: { length: number };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max diff characters to include in the judge prompt. Prevents token limit errors. */
export const MAX_DIFF_CHARS = 40_000;

/** Max output characters to include in the E2E judge prompt. */
export const MAX_OUTPUT_CHARS = 20_000;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Judge a spec run by comparing acceptance criteria against a git diff.
 * Returns a coverage map with per-criterion citations and a derived score.
 *
 * Never throws — returns a null-score result on any error.
 */
export async function judgeRun(
  specPath: string,
  diff: string,
  config: Config,
): Promise<JudgeResult> {
  const diffStats = parseDiffStats(diff);

  // Truncate diff if needed
  let truncatedDiff = diff;
  let diffNote = "";
  if (diff.length > MAX_DIFF_CHARS) {
    truncatedDiff = diff.slice(0, MAX_DIFF_CHARS);
    diffNote = `\n\n[diff truncated at ${MAX_DIFF_CHARS.toLocaleString()} chars — coverage may be partial for large changes]`;
  }

  // Read spec
  let specContent: string;
  try {
    specContent = readFileSync(specPath, "utf8");
  } catch (err) {
    return nullResult(diffStats, `Judge failed: cannot read spec file: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Build judge prompt
  const prompt = buildJudgePrompt(specContent, truncatedDiff + diffNote);

  // Run LLM judge
  let rawResponse: string;
  try {
    const agent = new Agent({ config });
    rawResponse = await agent.run(prompt);
  } catch (err) {
    return nullResult(diffStats, `Judge failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Parse response — try JSON first, fall back to text
  let criteria: CriterionResult[];
  try {
    criteria = parseJsonResponse(rawResponse);
  } catch {
    // JSON parse failed — try line-by-line text fallback
    criteria = parseTextFallback(rawResponse);
  }

  // Compute score
  const total = criteria.length;
  if (total === 0) {
    return {
      score: null,
      verdict: "No acceptance criteria found in spec",
      criteria: [],
      diffStats,
    };
  }

  const met = criteria.filter(c => c.status === "met").length;
  const partial = criteria.filter(c => c.status === "partial").length;
  const score = Math.round(((met * 1.0 + partial * 0.5) / total) * 10 * 10) / 10;

  // Extract verdict from JSON response if present, otherwise synthesize
  let verdict: string;
  try {
    const parsed = JSON.parse(rawResponse);
    verdict = typeof parsed.verdict === "string" ? parsed.verdict : synthesizeVerdict(criteria, score);
  } catch {
    verdict = synthesizeVerdict(criteria, score);
  }

  return { score, verdict, criteria, diffStats };
}

// ---------------------------------------------------------------------------
// Normative output format (used by CLI and report)
// ---------------------------------------------------------------------------

/**
 * Format a JudgeResult as the normative JUDGE REPORT terminal output.
 * Used by `phase2s judge` CLI and `phase2s report` when eval_judged is present.
 */
export function formatJudgeReport(specName: string, result: JudgeResult): string {
  const separator = "═".repeat(54);
  const lines: string[] = [];

  lines.push(`JUDGE REPORT — ${specName}`);
  lines.push(separator);

  if (result.score === null) {
    lines.push(`Score: — / 10  (no criteria found or judge failed)`);
  } else {
    const met = result.criteria.filter(c => c.status === "met").length;
    const partial = result.criteria.filter(c => c.status === "partial").length;
    const missed = result.criteria.filter(c => c.status === "missed").length;
    lines.push(`Score: ${result.score} / 10   (met: ${met}, partial: ${partial}, missed: ${missed})`);
  }
  lines.push("");

  for (const c of result.criteria) {
    lines.push(`criterion: "${c.text}"`);
    lines.push(`  status:     ${c.status}`);
    if (c.evidence) {
      const evidence = c.evidence.length > 120 ? c.evidence.slice(0, 117) + "..." : c.evidence;
      lines.push(`  evidence:   ${evidence}`);
    }
    if (c.status === "partial" || c.status === "missed") {
      // gap info may be embedded in evidence for partial
    }
    if (c.confidence > 0) {
      lines.push(`  confidence: ${c.confidence}`);
    }
    lines.push("");
  }

  lines.push(`verdict: ${result.verdict}`);
  lines.push(separator);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Exported helpers (also used directly in tests)
// ---------------------------------------------------------------------------

export function buildJudgePrompt(specContent: string, diff: string): string {
  return `You are a spec eval judge. Given a spec's acceptance criteria and a git diff, \
classify each criterion as met, partial, or missed based on whether the diff implements it.

Return a JSON object with this exact shape:
{
  "criteria": [
    {
      "text": "<criterion text>",
      "status": "met" | "partial" | "missed",
      "evidence": "<file:line-range or diff hunk reference, or (none found in diff)>",
      "confidence": <0.0–1.0>
    }
  ],
  "verdict": "<1-3 sentence narrative summary of overall coverage>"
}

Rules:
- Extract all acceptance criteria from the spec (look for "## Acceptance Criteria", "## Success Criteria", numbered/bulleted lists of testable criteria).
- For each criterion, search the diff for evidence. Be precise about file:line references.
- "met": clear implementation evidence in diff.
- "partial": implementation present but incomplete (e.g., logic added but no test, or partial coverage).
- "missed": no relevant changes found in diff.
- Confidence is your certainty that the classification is correct (not the criterion's importance).
- If no acceptance criteria are found in the spec, return {"criteria": [], "verdict": "No acceptance criteria found in spec"}.

SPEC:
${specContent}

GIT DIFF:
${diff}`;
}

export function parseJsonResponse(raw: string): CriterionResult[] {
  // Extract JSON from response (may be wrapped in markdown code fences)
  const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? raw.match(/(\{[\s\S]*\})/);
  const jsonStr = jsonMatch ? jsonMatch[1] : raw;
  const parsed = JSON.parse(jsonStr);

  if (!parsed.criteria || !Array.isArray(parsed.criteria)) {
    throw new Error("Invalid JSON structure: missing criteria array");
  }

  return parsed.criteria.map((c: unknown) => {
    if (typeof c !== "object" || c === null) throw new Error("Invalid criterion object");
    const obj = c as Record<string, unknown>;
    const status = obj.status as string;
    if (status !== "met" && status !== "partial" && status !== "missed") {
      throw new Error(`Invalid status: ${status}`);
    }
    return {
      text: String(obj.text ?? ""),
      status: status as CriterionStatus,
      evidence: String(obj.evidence ?? ""),
      confidence: typeof obj.confidence === "number" ? obj.confidence : 0,
    };
  });
}

export function parseTextFallback(raw: string): CriterionResult[] {
  // Text fallback format:
  //   MET: <criterion>
  //   PARTIAL: <criterion> — <reason>
  //   MISSED: <criterion>
  const results: CriterionResult[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("MET:")) {
      results.push({ text: trimmed.slice(4).trim(), status: "met", evidence: "", confidence: 0 });
    } else if (trimmed.startsWith("PARTIAL:")) {
      const rest = trimmed.slice(8).trim();
      const dashIdx = rest.indexOf(" — ");
      const text = dashIdx >= 0 ? rest.slice(0, dashIdx).trim() : rest;
      results.push({ text, status: "partial", evidence: "", confidence: 0 });
    } else if (trimmed.startsWith("MISSED:")) {
      results.push({ text: trimmed.slice(7).trim(), status: "missed", evidence: "", confidence: 0 });
    }
  }
  return results;
}

export function parseDiffStats(diff: string): { filesChanged: number; insertions: number; deletions: number } {
  if (!diff.trim()) return { filesChanged: 0, insertions: 0, deletions: 0 };
  let filesChanged = 0;
  let insertions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git")) filesChanged++;
    if (line.startsWith("+") && !line.startsWith("+++")) insertions++;
    if (line.startsWith("-") && !line.startsWith("---")) deletions++;
  }
  return { filesChanged, insertions, deletions };
}

function synthesizeVerdict(criteria: CriterionResult[], score: number): string {
  const met = criteria.filter(c => c.status === "met").length;
  const partial = criteria.filter(c => c.status === "partial").length;
  const missed = criteria.filter(c => c.status === "missed").length;
  const parts: string[] = [];
  if (met > 0) parts.push(`${met} criterion${met > 1 ? "ia" : ""} met`);
  if (partial > 0) parts.push(`${partial} partial`);
  if (missed > 0) parts.push(`${missed} missed`);
  return `Score ${score}/10. ${parts.join(", ")}.`;
}

function nullResult(
  diffStats: { filesChanged: number; insertions: number; deletions: number } | undefined,
  verdict: string,
): JudgeResult {
  return { score: null, verdict, criteria: [], ...(diffStats !== undefined ? { diffStats } : {}) };
}

// ---------------------------------------------------------------------------
// E2E judge — hybrid structural/quality criterion evaluation
// ---------------------------------------------------------------------------

/**
 * Judge an E2E runner result against the eval case's acceptance criteria.
 *
 * Hybrid evaluation:
 * - `type: "structural"` with `match`: regex test against output (no LLM call)
 * - `type: "quality"` (or missing type, or structural without match): LLM judge
 *
 * Never throws — returns { score: null } on any failure.
 */
export async function judgeE2E(
  runnerResult: RunnerResult,
  config: Config,
): Promise<JudgeResult> {
  const criteria = runnerResult.case.acceptance_criteria ?? [];
  const output = runnerResult.output ?? "";
  const responseStats = { length: output.length };

  if (criteria.length === 0) {
    return { score: null, verdict: "No acceptance criteria defined", criteria: [], responseStats };
  }

  const criteriaResults: CriterionResult[] = [];

  // --- Structural criteria: deterministic regex check ---
  const structuralIndices: number[] = [];
  const qualityIndices: number[] = [];

  for (let i = 0; i < criteria.length; i++) {
    const c = criteria[i];
    if (c.type === "structural" && c.match && c.match.trim()) {
      structuralIndices.push(i);
    } else {
      qualityIndices.push(i);
    }
  }

  // Fill placeholders so we can assign in order later
  for (let i = 0; i < criteria.length; i++) {
    criteriaResults.push({ text: criteria[i].text, status: "missed", evidence: "", confidence: 0 });
  }

  for (const i of structuralIndices) {
    const c = criteria[i];
    let status: CriterionStatus = "missed";
    let evidence = "(no match)";
    try {
      const m = new RegExp(c.match!, "i").exec(output);
      if (m) {
        status = "met";
        evidence = `matched: "${m[0]}"`;
      }
    } catch (err) {
      criteriaResults[i] = {
        text: c.text,
        status: "missed",
        evidence: `(invalid regex: ${(err as Error).message})`,
        confidence: 1.0,
      };
      continue;
    }
    criteriaResults[i] = { text: c.text, status, evidence, confidence: 1.0 };
  }

  // --- Quality criteria: LLM judge in one batch call ---
  if (qualityIndices.length > 0) {
    const qualityCriteria = qualityIndices.map(i => criteria[i]);
    const prompt = buildE2EJudgePrompt(output, qualityCriteria);

    let rawResponse: string;
    try {
      const agent = new Agent({ config });
      rawResponse = await agent.run(prompt);
    } catch (err) {
      return {
        score: null,
        verdict: `Judge failed: ${err instanceof Error ? err.message : String(err)}`,
        criteria: [],
        responseStats,
      };
    }

    let judgedCriteria: CriterionResult[];
    try {
      judgedCriteria = parseJsonResponse(rawResponse);
    } catch {
      judgedCriteria = parseTextFallback(rawResponse);
    }

    for (let j = 0; j < qualityIndices.length; j++) {
      const i = qualityIndices[j];
      if (j < judgedCriteria.length) {
        criteriaResults[i] = judgedCriteria[j];
      }
    }
  }

  // --- Score ---
  const total = criteriaResults.length;
  const met = criteriaResults.filter(c => c.status === "met").length;
  const partial = criteriaResults.filter(c => c.status === "partial").length;
  const score = Math.round(((met * 1.0 + partial * 0.5) / total) * 10 * 10) / 10;
  const verdict = synthesizeVerdict(criteriaResults, score);

  return { score, verdict, criteria: criteriaResults, responseStats };
}

function buildE2EJudgePrompt(output: string, criteria: CriterionSpec[]): string {
  const safeOutput = output.length > MAX_OUTPUT_CHARS
    ? output.slice(0, MAX_OUTPUT_CHARS) + `\n\n[output truncated at ${MAX_OUTPUT_CHARS} chars]`
    : output;
  const criteriaList = criteria.map((c, i) => `${i + 1}. ${c.text}`).join("\n");
  return `You are an eval judge. Given the output of an AI skill and a list of quality criteria, \
classify each criterion as met, partial, or missed based on the output.

Return a JSON object with this exact shape:
{
  "criteria": [
    {
      "text": "<criterion text>",
      "status": "met" | "partial" | "missed",
      "evidence": "<quote or reference from the output, or (none found)>",
      "confidence": <0.0–1.0>
    }
  ],
  "verdict": "<1-2 sentence summary>"
}

Rules:
- Evaluate criteria in the order listed. Return exactly ${criteria.length} criterion object(s).
- "met": the output clearly satisfies the criterion.
- "partial": the criterion is partially addressed but incomplete.
- "missed": the output does not address the criterion.
- Evidence must cite actual text from the output (quote ≤ 80 chars) or "(none found)".

CRITERIA TO EVALUATE:
${criteriaList}

SKILL OUTPUT:
${safeOutput}`;
}
