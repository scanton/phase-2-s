import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeEvalResults } from "../../src/eval/reporter.js";
import type { RunnerResult } from "../../src/eval/runner.js";
import type { JudgeResult } from "../../src/eval/judge.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRunnerResult(skill = "adversarial"): RunnerResult {
  return {
    case: {
      name: `${skill}-basic`,
      skill,
      inputs: { plan: "test plan" },
      acceptance_criteria: [{ text: "Contains VERDICT", type: "structural", match: "VERDICT:" }],
    },
    output: "VERDICT: CHALLENGED\nSTRONGEST_CONCERN: state loss",
    elapsed_ms: 1234,
  };
}

function makeJudgeResult(score = 8.5): JudgeResult {
  return {
    score,
    verdict: "Good coverage.",
    criteria: [
      { text: "Contains VERDICT", status: "met", evidence: "matched: VERDICT:", confidence: 1.0 },
    ],
    responseStats: { length: 48 },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("writeEvalResults", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "reporter-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates the output directory if it does not exist", () => {
    const nested = join(tmpDir, "deep", "nested", "evals");
    writeEvalResults([makeRunnerResult()], [makeJudgeResult()], nested);
    const files = readdirSync(nested);
    expect(files.length).toBeGreaterThan(0);
  });

  it("writes two files per result: one e2e-run and one llm-judge", () => {
    writeEvalResults([makeRunnerResult()], [makeJudgeResult()], tmpDir);
    const files = readdirSync(tmpDir);
    const e2eFiles = files.filter(f => f.includes("-e2e-run-"));
    const judgeFiles = files.filter(f => f.includes("-llm-judge-run-"));
    expect(e2eFiles).toHaveLength(1);
    expect(judgeFiles).toHaveLength(1);
  });

  it("filenames include the skill name", () => {
    writeEvalResults([makeRunnerResult("adversarial")], [makeJudgeResult()], tmpDir);
    const files = readdirSync(tmpDir);
    expect(files.some(f => f.startsWith("adversarial-"))).toBe(true);
  });

  it("e2e filename matches gate glob pattern: *-e2e-*-YYYY-MM-DD*.json", () => {
    writeEvalResults([makeRunnerResult()], [makeJudgeResult()], tmpDir);
    const files = readdirSync(tmpDir);
    const e2eFile = files.find(f => f.includes("-e2e-run-"));
    expect(e2eFile).toBeDefined();
    // Must have -run- segment between e2e and date
    expect(e2eFile).toMatch(/-e2e-run-\d{4}-\d{2}-\d{2}-\d+\.json$/);
  });

  it("llm-judge filename matches gate glob pattern: *-llm-judge-*-YYYY-MM-DD*.json", () => {
    writeEvalResults([makeRunnerResult()], [makeJudgeResult()], tmpDir);
    const files = readdirSync(tmpDir);
    const judgeFile = files.find(f => f.includes("-llm-judge-run-"));
    expect(judgeFile).toBeDefined();
    expect(judgeFile).toMatch(/-llm-judge-run-\d{4}-\d{2}-\d{2}-\d+\.json$/);
  });

  it("e2e file contains case, output, and elapsed_ms", () => {
    writeEvalResults([makeRunnerResult()], [makeJudgeResult()], tmpDir);
    const files = readdirSync(tmpDir);
    const e2eFile = files.find(f => f.includes("-e2e-run-"))!;
    const json = JSON.parse(readFileSync(join(tmpDir, e2eFile), "utf8"));
    expect(json).toHaveProperty("case");
    expect(json).toHaveProperty("output");
    expect(json).toHaveProperty("elapsed_ms");
  });

  it("judge file contains score, verdict, and criteria", () => {
    writeEvalResults([makeRunnerResult()], [makeJudgeResult()], tmpDir);
    const files = readdirSync(tmpDir);
    const judgeFile = files.find(f => f.includes("-llm-judge-run-"))!;
    const json = JSON.parse(readFileSync(join(tmpDir, judgeFile), "utf8"));
    expect(json).toHaveProperty("score", 8.5);
    expect(json).toHaveProperty("verdict");
    expect(json).toHaveProperty("criteria");
  });

  it("writes files for multiple results", () => {
    writeEvalResults(
      [makeRunnerResult("adversarial"), makeRunnerResult("review")],
      [makeJudgeResult(8.0), makeJudgeResult(7.0)],
      tmpDir,
    );
    const files = readdirSync(tmpDir);
    expect(files).toHaveLength(4); // 2 e2e + 2 judge
  });
});
