import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Shared mutable state for mocks
// ---------------------------------------------------------------------------

const runnerState = vi.hoisted(() => ({
  results: [] as Array<{
    case: {
      name: string;
      skill: string;
      inputs: Record<string, string>;
      acceptance_criteria: Array<{ text: string; type?: string; match?: string }>;
    };
    output: string;
    elapsed_ms: number;
    error?: string;
  }>,
}));

const judgeState = vi.hoisted(() => ({
  score: 8.5 as number | null,
}));

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../../src/core/config.js", () => ({
  loadConfig: vi.fn(async () => ({ provider: "openai", model: "gpt-4o" })),
}));

vi.mock("../../src/eval/runner.js", () => ({
  runAllEvals: vi.fn(async () => runnerState.results),
}));

vi.mock("../../src/eval/judge.js", () => ({
  judgeE2E: vi.fn(async () => ({
    score: judgeState.score,
    verdict: "Test verdict.",
    criteria: [],
    responseStats: { length: 100 },
  })),
}));

vi.mock("../../src/eval/reporter.js", () => ({
  writeEvalResults: vi.fn(),
  DEFAULT_OUTPUT_DIR: "/tmp/test-evals",
}));

// ---------------------------------------------------------------------------
// Import main after mocks are set up
// ---------------------------------------------------------------------------

import { main } from "../../src/eval/cli.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRunnerResult(skill = "adversarial") {
  return {
    case: {
      name: `${skill}-test`,
      skill,
      inputs: {},
      acceptance_criteria: [
        { text: "Contains VERDICT", type: "structural", match: "VERDICT:" },
      ],
    },
    output: "VERDICT: CHALLENGED",
    elapsed_ms: 1000,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("cli gate — exit codes", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation((_code?: number) => {
      return undefined as never;
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("all scores >= 6.0 → process.exit NOT called with 1", async () => {
    runnerState.results = [makeRunnerResult("adversarial")];
    judgeState.score = 8.5;

    await main();

    const exit1Calls = exitSpy.mock.calls.filter(args => args[0] === 1);
    expect(exit1Calls).toHaveLength(0);
  });

  it("one score < 6.0 → process.exit(1) is called", async () => {
    runnerState.results = [makeRunnerResult("adversarial")];
    judgeState.score = 4.0;

    await main();

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("score exactly 6.0 → gate passes (exit NOT called with 1)", async () => {
    runnerState.results = [makeRunnerResult("adversarial")];
    judgeState.score = 6.0;

    await main();

    const exit1Calls = exitSpy.mock.calls.filter(args => args[0] === 1);
    expect(exit1Calls).toHaveLength(0);
  });

  it("empty results → does not call process.exit(1)", async () => {
    runnerState.results = [];
    judgeState.score = 8.5;

    await main();

    const exit1Calls = exitSpy.mock.calls.filter(args => args[0] === 1);
    expect(exit1Calls).toHaveLength(0);
  });
});
