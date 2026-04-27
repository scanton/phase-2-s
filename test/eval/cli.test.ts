import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Shared mutable state for mocks — Pattern A: module-level let + wrapper
// ---------------------------------------------------------------------------

let mockRunnerResults: Array<{
  case: {
    name: string;
    skill: string;
    inputs: Record<string, string>;
    acceptance_criteria: Array<{ text: string; type?: string; match?: string }>;
  };
  output: string;
  elapsed_ms: number;
  error?: string;
}> = [];

let mockJudgeScore: number | null = 8.5;
let mockJudgeScoreQueue: (number | null)[] = [];

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../../src/core/config.js", () => ({
  loadConfig: vi.fn(async () => ({ provider: "openai", model: "gpt-4o" })),
}));

vi.mock("../../src/eval/runner.js", () => ({
  runAllEvals: (...args: unknown[]) => Promise.resolve(mockRunnerResults),
}));

vi.mock("../../src/eval/judge.js", () => ({
  judgeE2E: (...args: unknown[]) => Promise.resolve({
    score: mockJudgeScoreQueue.length > 0 ? mockJudgeScoreQueue.shift()! : mockJudgeScore,
    verdict: "Test verdict.",
    criteria: [],
    responseStats: { length: 100 },
  }),
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

function makeRunnerResult(skill = "adversarial", name?: string) {
  return {
    case: {
      name: name ?? `${skill}-test`,
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
    mockRunnerResults = [];
    mockJudgeScore = 8.5;
    mockJudgeScoreQueue = [];
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
    mockRunnerResults = [makeRunnerResult("adversarial")];
    mockJudgeScore = 8.5;

    await main();

    const exit1Calls = exitSpy.mock.calls.filter(args => args[0] === 1);
    expect(exit1Calls).toHaveLength(0);
  });

  it("one score < 6.0 → process.exit(1) is called", async () => {
    mockRunnerResults = [makeRunnerResult("adversarial")];
    mockJudgeScore = 4.0;

    await main();

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("score exactly 6.0 → gate passes (exit NOT called with 1)", async () => {
    mockRunnerResults = [makeRunnerResult("adversarial")];
    mockJudgeScore = 6.0;

    await main();

    const exit1Calls = exitSpy.mock.calls.filter(args => args[0] === 1);
    expect(exit1Calls).toHaveLength(0);
  });

  it("empty results → does not call process.exit(1)", async () => {
    mockRunnerResults = [];
    mockJudgeScore = 8.5;

    await main();

    const exit1Calls = exitSpy.mock.calls.filter(args => args[0] === 1);
    expect(exit1Calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// scoresBySkill — multi-case accumulation
// ---------------------------------------------------------------------------

describe("cli scoresBySkill — multi-case same skill", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockRunnerResults = [];
    mockJudgeScore = 8.5;
    mockJudgeScoreQueue = [];
    exitSpy = vi.spyOn(process, "exit").mockImplementation((_code?: number) => undefined as never);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("two cases with the same skill → score summary shows min-max range", async () => {
    mockRunnerResults = [
      makeRunnerResult("adversarial", "adversarial-case-1"),
      makeRunnerResult("adversarial", "adversarial-case-2"),
    ];
    // Return different scores for the two judgeE2E calls
    mockJudgeScoreQueue = [7.0, 9.0];

    await main();

    const allLogs = logSpy.mock.calls.map(c => c[0] as string).join("\n");
    // Score line must show range format: adversarial=7-9
    expect(allLogs).toMatch(/adversarial=7-9/);
    // Both scores pass the 6.0 gate
    const exit1Calls = exitSpy.mock.calls.filter(args => args[0] === 1);
    expect(exit1Calls).toHaveLength(0);
  });

  it("two cases with the same score → summary shows scalar, not range", async () => {
    mockRunnerResults = [
      makeRunnerResult("adversarial", "adversarial-case-1"),
      makeRunnerResult("adversarial", "adversarial-case-2"),
    ];
    mockJudgeScore = 8.5; // both calls return 8.5

    await main();

    const allLogs = logSpy.mock.calls.map(c => c[0] as string).join("\n");
    // min === max → scalar display, not range
    expect(allLogs).toMatch(/adversarial=8\.5/);
    expect(allLogs).not.toMatch(/adversarial=8\.5-8\.5/);
  });
});
