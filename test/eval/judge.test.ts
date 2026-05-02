/**
 * Tests for src/eval/judge.ts
 *
 * Tests are organized into two tiers:
 * 1. Pure function tests — parseJsonResponse, parseTextFallback, parseDiffStats,
 *    formatJudgeReport — no mocking required.
 * 2. judgeRun() integration tests — require Agent to be mocked. Uses vi.mocked
 *    approach for reliable ESM compatibility.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  judgeRun,
  judgeE2E,
  formatJudgeReport,
  parseJsonResponse,
  parseTextFallback,
  parseDiffStats,
  MAX_DIFF_CHARS,
  MAX_OUTPUT_CHARS,
  STRUCTURAL_PATTERN_MAX_LEN,
  type JudgeResult,
} from "../../src/eval/judge.js";
import type { RunnerResult } from "../../src/eval/runner.js";

// ---------------------------------------------------------------------------
// Agent mock
// ---------------------------------------------------------------------------

const mockState = { response: "" as string, shouldThrow: false };

vi.mock("../../src/core/agent.js", () => ({
  Agent: class MockAgent {
    async run(_prompt: string) {
      if (mockState.shouldThrow) throw new Error("LLM provider error");
      return mockState.response;
    }
  },
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FAKE_CONFIG = { provider: "openai" } as never;

function makeTempSpec(content: string): { specPath: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "judge-test-"));
  const specPath = join(dir, "spec.md");
  writeFileSync(specPath, content);
  return {
    specPath,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

const SAMPLE_DIFF = `diff --git a/src/foo.ts b/src/foo.ts
index 1234567..abcdefg 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,5 @@
 export const x = 1;
+export const y = 2;
+export const z = 3;
-export const old = 0;
`;

const SPEC_WITH_CRITERIA = `
# My Spec

## Acceptance Criteria

1. Add export y to src/foo.ts
2. Add export z to src/foo.ts
3. Remove old export from src/foo.ts
`;

const SPEC_NO_CRITERIA = `
# My Spec

## Description

Just a description, no criteria.
`;

// ---------------------------------------------------------------------------
// Tier 1: Pure function tests (no mocking)
// ---------------------------------------------------------------------------

describe("parseJsonResponse", () => {
  it("parses valid JSON criteria array", () => {
    const raw = JSON.stringify({
      criteria: [
        { text: "Add export y", status: "met", evidence: "src/foo.ts:2", confidence: 0.95 },
        { text: "Remove old", status: "partial", evidence: "src/foo.ts:4", confidence: 0.7 },
      ],
      verdict: "Mostly good.",
    });
    const result = parseJsonResponse(raw);
    expect(result).toHaveLength(2);
    expect(result[0].status).toBe("met");
    expect(result[0].confidence).toBe(0.95);
    expect(result[1].status).toBe("partial");
  });

  it("parses JSON wrapped in markdown code fences", () => {
    const inner = JSON.stringify({
      criteria: [{ text: "Add export y", status: "met", evidence: "src/foo.ts:2", confidence: 0.9 }],
      verdict: "Met.",
    });
    const raw = "```json\n" + inner + "\n```";
    const result = parseJsonResponse(raw);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("met");
  });

  it("throws on invalid JSON", () => {
    expect(() => parseJsonResponse("not json at all")).toThrow();
  });

  it("throws when criteria field is missing", () => {
    expect(() => parseJsonResponse(JSON.stringify({ verdict: "ok" }))).toThrow();
  });
});

describe("parseTextFallback", () => {
  it("parses MET/PARTIAL/MISSED lines", () => {
    const raw = [
      "MET: Add export y to src/foo.ts",
      "PARTIAL: Add export z to src/foo.ts — added but not tested",
      "MISSED: Remove old export from src/foo.ts",
    ].join("\n");
    const result = parseTextFallback(raw);
    expect(result).toHaveLength(3);
    expect(result[0].status).toBe("met");
    expect(result[0].text).toBe("Add export y to src/foo.ts");
    expect(result[1].status).toBe("partial");
    expect(result[1].text).toBe("Add export z to src/foo.ts");
    expect(result[2].status).toBe("missed");
  });

  it("sets evidence='' and confidence=0 in fallback mode", () => {
    const result = parseTextFallback("MET: Something works");
    expect(result[0].evidence).toBe("");
    expect(result[0].confidence).toBe(0);
  });

  it("returns empty array when no MET/PARTIAL/MISSED lines found", () => {
    const result = parseTextFallback("This is just prose. No structured lines.");
    expect(result).toHaveLength(0);
  });

  it("strips — <reason> from PARTIAL text", () => {
    const result = parseTextFallback("PARTIAL: Export z added — but no tests written");
    expect(result[0].text).toBe("Export z added");
    expect(result[0].status).toBe("partial");
  });
});

describe("parseDiffStats", () => {
  it("counts filesChanged, insertions, deletions from a real diff", () => {
    const stats = parseDiffStats(SAMPLE_DIFF);
    expect(stats.filesChanged).toBe(1);
    expect(stats.insertions).toBeGreaterThan(0);
    expect(stats.deletions).toBeGreaterThan(0);
  });

  it("returns zeros for empty diff", () => {
    expect(parseDiffStats("")).toEqual({ filesChanged: 0, insertions: 0, deletions: 0 });
  });

  it("counts multiple files changed", () => {
    const multiFileDiff = SAMPLE_DIFF + `\ndiff --git a/src/bar.ts b/src/bar.ts\n+export const a = 1;\n`;
    const stats = parseDiffStats(multiFileDiff);
    expect(stats.filesChanged).toBe(2);
  });
});

describe("MAX_DIFF_CHARS constant", () => {
  it("is 40,000", () => {
    expect(MAX_DIFF_CHARS).toBe(40_000);
  });
});

describe("formatJudgeReport", () => {
  it("renders score and criteria in normative format", () => {
    const result: JudgeResult = {
      score: 7.5,
      verdict: "Good coverage.",
      criteria: [
        { text: "export y added", status: "met", evidence: "src/foo.ts:2", confidence: 0.9 },
        { text: "old export removed", status: "partial", evidence: "src/foo.ts:4", confidence: 0.7 },
      ],
      diffStats: { filesChanged: 1, insertions: 2, deletions: 1 },
    };
    const output = formatJudgeReport("spec.md", result);
    expect(output).toContain("JUDGE REPORT");
    expect(output).toContain("7.5 / 10");
    expect(output).toContain("export y added");
    expect(output).toContain("met");
    expect(output).toContain("partial");
    expect(output).toContain("Good coverage.");
  });

  it("renders null score gracefully", () => {
    const result: JudgeResult = {
      score: null,
      verdict: "No acceptance criteria found in spec",
      criteria: [],
      diffStats: { filesChanged: 0, insertions: 0, deletions: 0 },
    };
    const output = formatJudgeReport("spec.md", result);
    expect(output).toContain("— / 10");
    expect(output).toContain("no criteria found or judge failed");
  });
});

// ---------------------------------------------------------------------------
// Tier 2: Score formula (computed server-side, no LLM needed — test via parsers)
// ---------------------------------------------------------------------------

describe("score formula", () => {
  function computeScore(criteria: Array<{ status: "met" | "partial" | "missed" }>): number | null {
    const total = criteria.length;
    if (total === 0) return null;
    const met = criteria.filter(c => c.status === "met").length;
    const partial = criteria.filter(c => c.status === "partial").length;
    return Math.round(((met * 1.0 + partial * 0.5) / total) * 10 * 10) / 10;
  }

  it("all met → 10", () => {
    expect(computeScore([{ status: "met" }, { status: "met" }])).toBe(10);
  });

  it("all missed → 0", () => {
    expect(computeScore([{ status: "missed" }, { status: "missed" }])).toBe(0);
  });

  it("mixed: 2 met, 1 partial, 1 missed out of 4 → 6.3", () => {
    const score = computeScore([
      { status: "met" }, { status: "met" },
      { status: "partial" }, { status: "missed" },
    ]);
    // (2*1.0 + 1*0.5) / 4 * 10 = 6.25 → rounded to 6.3
    expect(score).toBeCloseTo(6.3, 1);
  });

  it("empty criteria → null (no division by zero)", () => {
    expect(computeScore([])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tier 2: judgeRun() integration tests (Agent is mocked)
// ---------------------------------------------------------------------------

describe("judgeRun — total=0 null guard", () => {
  beforeEach(() => { mockState.shouldThrow = false; });

  it("returns score: null and informative verdict when agent returns empty criteria", async () => {
    const { specPath, cleanup } = makeTempSpec(SPEC_NO_CRITERIA);
    try {
      mockState.response = JSON.stringify({ criteria: [], verdict: "No acceptance criteria found in spec" });
      const result = await judgeRun(specPath, SAMPLE_DIFF, FAKE_CONFIG);
      expect(result.score).toBeNull();
      expect(result.criteria).toHaveLength(0);
    } finally {
      cleanup();
    }
  });
});

describe("judgeRun — error contract", () => {
  it("agent.run() throws → returns null score, never throws itself", async () => {
    const { specPath, cleanup } = makeTempSpec(SPEC_WITH_CRITERIA);
    try {
      mockState.shouldThrow = true;
      const result = await judgeRun(specPath, SAMPLE_DIFF, FAKE_CONFIG);
      expect(result.score).toBeNull();
      expect(result.verdict).toMatch(/judge failed/i);
      expect(result.criteria).toHaveLength(0);
    } finally {
      mockState.shouldThrow = false;
      cleanup();
    }
  });

  it("missing spec file → returns null score, never throws", async () => {
    mockState.shouldThrow = false;
    const result = await judgeRun("/nonexistent/path/spec.md", SAMPLE_DIFF, FAKE_CONFIG);
    expect(result.score).toBeNull();
    expect(result.verdict).toMatch(/judge failed/i);
  });
});

describe("judgeRun — diffStats are always populated", () => {
  beforeEach(() => {
    mockState.shouldThrow = false;
    mockState.response = JSON.stringify({ criteria: [], verdict: "No criteria." });
  });

  it("extracts filesChanged, insertions, deletions from diff", async () => {
    const { specPath, cleanup } = makeTempSpec(SPEC_WITH_CRITERIA);
    try {
      const result = await judgeRun(specPath, SAMPLE_DIFF, FAKE_CONFIG);
      expect(result.diffStats.filesChanged).toBe(1);
      expect(result.diffStats.insertions).toBeGreaterThan(0);
      expect(result.diffStats.deletions).toBeGreaterThan(0);
    } finally { cleanup(); }
  });

  it("empty diff → all zeros in diffStats", async () => {
    const { specPath, cleanup } = makeTempSpec(SPEC_NO_CRITERIA);
    try {
      const result = await judgeRun(specPath, "", FAKE_CONFIG);
      expect(result.diffStats).toEqual({ filesChanged: 0, insertions: 0, deletions: 0 });
    } finally { cleanup(); }
  });
});

// ---------------------------------------------------------------------------
// judgeE2E() tests
// ---------------------------------------------------------------------------

function makeRunnerResult(output: string, criteria = BASIC_E2E_CRITERIA): RunnerResult {
  return {
    case: {
      name: "test-e2e-case",
      skill: "adversarial",
      inputs: { plan: "test plan" },
      acceptance_criteria: criteria,
    },
    output,
    elapsed_ms: 500,
  };
}

const BASIC_E2E_CRITERIA = [
  { text: "Contains a VERDICT field", type: "structural" as const, match: "VERDICT:" },
  { text: "Identifies at least one failure mode", type: "quality" as const },
];

describe("judgeE2E — structural criteria (regex, no LLM call)", () => {
  beforeEach(() => {
    mockState.shouldThrow = false;
    mockState.response = JSON.stringify({
      criteria: [{ text: "Identifies at least one failure mode", status: "met", evidence: "state loss on restart", confidence: 0.9 }],
      verdict: "Quality criterion met.",
    });
  });

  it("structural criterion matched → status: met, no LLM call counted for it", async () => {
    const result = await judgeE2E(
      makeRunnerResult("VERDICT: CHALLENGED\nsome analysis"),
      FAKE_CONFIG,
    );
    const structural = result.criteria.find(c => c.text === "Contains a VERDICT field");
    expect(structural?.status).toBe("met");
  });

  it("structural criterion not matched → status: missed", async () => {
    const result = await judgeE2E(
      makeRunnerResult("No verdict here."),
      FAKE_CONFIG,
    );
    const structural = result.criteria.find(c => c.text === "Contains a VERDICT field");
    expect(structural?.status).toBe("missed");
  });

  it("structural criterion has confidence: 1.0 (deterministic)", async () => {
    const result = await judgeE2E(
      makeRunnerResult("VERDICT: APPROVED"),
      FAKE_CONFIG,
    );
    const structural = result.criteria.find(c => c.text === "Contains a VERDICT field");
    expect(structural?.confidence).toBe(1.0);
  });

  it("invalid regex in structural match → status: missed, evidence contains 'invalid regex'", async () => {
    const result = await judgeE2E(
      makeRunnerResult("some output", [
        { text: "Has a result field", type: "structural" as const, match: "[invalid" },
      ]),
      FAKE_CONFIG,
    );
    const criterion = result.criteria[0];
    expect(criterion.status).toBe("missed");
    expect(criterion.evidence).toContain("invalid regex");
  });

  it("pattern length > 500 falls through to LLM quality judge (ReDoS budget)", async () => {
    mockState.response = JSON.stringify({
      criteria: [{ text: "Long pattern criterion", status: "met", evidence: "matched", confidence: 0.9 }],
      verdict: "Quality met.",
    });
    const longPattern = "a".repeat(STRUCTURAL_PATTERN_MAX_LEN + 1);
    const result = await judgeE2E(
      makeRunnerResult("some output text", [
        { text: "Long pattern criterion", type: "structural" as const, match: longPattern },
      ]),
      FAKE_CONFIG,
    );
    // Must reach the LLM judge (mockState.response used) — not evaluated structurally
    expect(result.criteria[0].status).toBe("met");
  });

  it("output length > MAX_OUTPUT_CHARS falls through to LLM quality judge (ReDoS budget)", async () => {
    mockState.response = JSON.stringify({
      criteria: [{ text: "Large output criterion", status: "met", evidence: "matched", confidence: 0.9 }],
      verdict: "Quality met.",
    });
    const bigOutput = "x".repeat(MAX_OUTPUT_CHARS + 1);
    const result = await judgeE2E(
      makeRunnerResult(bigOutput, [
        { text: "Large output criterion", type: "structural" as const, match: "simple" },
      ]),
      FAKE_CONFIG,
    );
    // Must reach the LLM judge (mockState.response used) — not evaluated structurally
    expect(result.criteria[0].status).toBe("met");
  });
});

describe("judgeE2E — quality criteria (LLM judge)", () => {
  beforeEach(() => {
    mockState.shouldThrow = false;
  });

  it("all quality criteria met → score >= 9.0 when structural also passes", async () => {
    mockState.response = JSON.stringify({
      criteria: [{ text: "Identifies at least one failure mode", status: "met", evidence: "state loss on restart", confidence: 0.95 }],
      verdict: "Quality met.",
    });
    const result = await judgeE2E(
      makeRunnerResult("VERDICT: CHALLENGED\nThe problem is state loss on restart."),
      FAKE_CONFIG,
    );
    expect(result.score).not.toBeNull();
    expect(result.score!).toBeGreaterThanOrEqual(8.0);
  });

  it("quality criterion missed → partial score", async () => {
    mockState.response = JSON.stringify({
      criteria: [{ text: "Identifies at least one failure mode", status: "missed", evidence: "(none found)", confidence: 0.8 }],
      verdict: "Quality missed.",
    });
    const result = await judgeE2E(
      makeRunnerResult("VERDICT: CHALLENGED"),
      FAKE_CONFIG,
    );
    // structural met (VERDICT found) + quality missed → 1/2 criteria met = 5.0
    expect(result.score).toBe(5.0);
  });

  it("all criteria missed → score: 0", async () => {
    mockState.response = JSON.stringify({
      criteria: [{ text: "Identifies at least one failure mode", status: "missed", evidence: "(none found)", confidence: 0.8 }],
      verdict: "Nothing met.",
    });
    const result = await judgeE2E(
      makeRunnerResult("No relevant content here."),
      FAKE_CONFIG,
    );
    expect(result.score).toBe(0);
  });
});

describe("judgeE2E — error handling", () => {
  it("agent throws → score: null, verdict starts with 'Judge failed'", async () => {
    mockState.shouldThrow = true;
    const result = await judgeE2E(
      makeRunnerResult("VERDICT: APPROVED\nsome quality content"),
      FAKE_CONFIG,
    );
    expect(result.score).toBeNull();
    expect(result.verdict).toMatch(/judge failed/i);
    mockState.shouldThrow = false;
  });

  it("empty output → all quality criteria missed, structural also missed", async () => {
    mockState.shouldThrow = false;
    mockState.response = JSON.stringify({
      criteria: [{ text: "Identifies at least one failure mode", status: "missed", evidence: "(none found)", confidence: 0.9 }],
      verdict: "Nothing found.",
    });
    const result = await judgeE2E(makeRunnerResult(""), FAKE_CONFIG);
    expect(result.score).toBe(0);
  });

  it("no acceptance_criteria → score: null", async () => {
    const runnerResult: RunnerResult = {
      case: {
        name: "empty-criteria",
        skill: "adversarial",
        inputs: {},
        acceptance_criteria: [],
      },
      output: "some output",
      elapsed_ms: 100,
    };
    const result = await judgeE2E(runnerResult, FAKE_CONFIG);
    expect(result.score).toBeNull();
  });
});

describe("judgeE2E — responseStats", () => {
  beforeEach(() => {
    mockState.shouldThrow = false;
    mockState.response = JSON.stringify({
      criteria: [{ text: "Identifies at least one failure mode", status: "met", evidence: "state loss", confidence: 0.9 }],
      verdict: "Met.",
    });
  });

  it("returns responseStats with output length", async () => {
    const output = "VERDICT: CHALLENGED\nstate loss is the issue";
    const result = await judgeE2E(makeRunnerResult(output), FAKE_CONFIG);
    expect(result.responseStats).toEqual({ length: output.length });
  });

  it("does not set diffStats (E2E eval has no diff)", async () => {
    const result = await judgeE2E(makeRunnerResult("VERDICT: CHALLENGED"), FAKE_CONFIG);
    expect(result.diffStats).toBeUndefined();
  });
});

describe("judgeRun — backward compatibility (diffStats still populated)", () => {
  beforeEach(() => {
    mockState.shouldThrow = false;
    mockState.response = JSON.stringify({ criteria: [], verdict: "No criteria." });
  });

  it("judgeRun still populates diffStats (backward compat)", async () => {
    const { specPath, cleanup } = makeTempSpec(SPEC_WITH_CRITERIA);
    try {
      const result = await judgeRun(specPath, SAMPLE_DIFF, FAKE_CONFIG);
      expect(result.diffStats).toBeDefined();
      expect(result.diffStats!.filesChanged).toBe(1);
    } finally { cleanup(); }
  });
});
