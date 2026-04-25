/**
 * Integration test: runGoal with --judge flag emits eval_judged event to JSONL log.
 *
 * Uses its own mock setup (separate from goal.test.ts) so the judge-specific
 * mocking doesn't interfere with the main goal test suite.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("../../src/core/config.js", () => ({
  loadConfig: vi.fn().mockResolvedValue({
    provider: "codex-cli",
    model: "gpt-4o",
    maxTurns: 50,
    timeout: 120_000,
    allowDestructive: false,
    requireSpecification: false,
  }),
}));

vi.mock("../../src/core/memory.js", () => ({
  loadLearnings: vi.fn().mockResolvedValue([]),
  loadRelevantLearnings: vi.fn().mockResolvedValue([]),
  formatLearningsForPrompt: vi.fn().mockReturnValue(""),
}));

// Agent mock: call 1 = subtask execution (any string), call 2 = criteria check (PASS: criterion)
let agentCallCount = 0;
vi.mock("../../src/core/agent.js", () => {
  class MockAgent {
    run = vi.fn().mockImplementation(async () => {
      agentCallCount++;
      // First call: subtask execution — return anything
      if (agentCallCount <= 1) return "Implemented successfully.";
      // Subsequent calls: criteria checking — return PASS for the criterion
      return "PASS: It works";
    });
  }
  return { Agent: MockAgent };
});

vi.mock("../../src/skills/index.js", () => ({
  loadAllSkills: vi.fn().mockResolvedValue([
    { name: "satori", description: "satori", model: "smart", promptTemplate: "Implement it.", retries: 1, triggers: [] },
  ]),
}));

// Mock judgeRun to avoid real LLM calls and control the returned result
const mockJudgeResult = {
  score: 8.5,
  verdict: "Good coverage. Core criterion met.",
  criteria: [
    { text: "It works", status: "met", evidence: "src/foo.ts:1", confidence: 0.9 },
  ],
  diffStats: { filesChanged: 1, insertions: 3, deletions: 0 },
};
const mockJudgeRun = vi.fn().mockResolvedValue(mockJudgeResult);
vi.mock("../../src/eval/judge.js", () => ({
  judgeRun: mockJudgeRun,
  formatJudgeReport: vi.fn().mockReturnValue("JUDGE REPORT\n========\nScore: 8.5 / 10"),
}));

// Mock merge-strategy git utilities so we don't need a real git repo for judge
vi.mock("../../src/goal/merge-strategy.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/goal/merge-strategy.js")>();
  return {
    ...original,
    getHeadSha: vi.fn().mockReturnValue("abc123def456"),
    getDiff: vi.fn().mockReturnValue("diff --git a/src/foo.ts b/src/foo.ts\n+export const x = 1;\n"),
    cleanAllWorktrees: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const JUDGE_SPEC_MD = `# Test Feature

## Problem Statement
A simple test for --judge flag.

## Task Decomposition
- **Task 1**: Do the thing
  - Input: nothing
  - Output: something
  - Success criteria: it works

## Acceptance Criteria
- It works

## Eval Command
\`\`\`
echo done
\`\`\`

## Constraints
- Must do: keep it simple
`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runGoal — --judge flag emits eval_judged event", () => {
  let tmpDir: string;
  let specPath: string;

  beforeEach(() => {
    agentCallCount = 0;
    mockJudgeRun.mockClear();
    tmpDir = join(tmpdir(), `phase2s-goal-judge-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    specPath = join(tmpDir, "spec.md");
    writeFileSync(specPath, JUDGE_SPEC_MD, "utf8");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("runGoal with judge:true calls judgeRun and emits eval_judged event to JSONL log", async () => {
    const { runGoal } = await import("../../src/cli/goal.js");

    // Change cwd to tmpDir so run logs and state files land there
    const origCwd = process.cwd();
    process.chdir(tmpDir);

    let result;
    try {
      result = await runGoal(specPath, {
        maxAttempts: "1",
        judge: true,
      });
    } finally {
      process.chdir(origCwd);
    }

    // judgeRun must have been called
    expect(mockJudgeRun).toHaveBeenCalled();

    // The JSONL log should contain an eval_judged event
    if (result?.runLogPath) {
      const logContent = readFileSync(result.runLogPath, "utf8");
      const events = logContent.trim().split("\n").map(l => JSON.parse(l));
      const judgeEvent = events.find((e: { event: string }) => e.event === "eval_judged");
      expect(judgeEvent).toBeDefined();
      expect(judgeEvent?.score).toBe(8.5);
      expect(judgeEvent?.runId).toBeDefined();
    }
  });
});
