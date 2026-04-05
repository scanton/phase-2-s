/**
 * Tests for the Phase2S GitHub Action (src/action/index.ts).
 *
 * All external dependencies are mocked:
 *   - @actions/core  — getInput, setOutput, setFailed, info, warning
 *   - @actions/exec  — exec (returns exit code, streams via listeners)
 *   - @actions/github — context, getOctokit
 *   - node:fs        — appendFileSync (for GITHUB_STEP_SUMMARY)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Mocks ---

const mockGetInput = vi.fn();
const mockSetOutput = vi.fn();
const mockSetFailed = vi.fn();
const mockInfo = vi.fn();
const mockWarning = vi.fn();

vi.mock("@actions/core", () => ({
  getInput: (...args: unknown[]) => mockGetInput(...args),
  setOutput: (...args: unknown[]) => mockSetOutput(...args),
  setFailed: (...args: unknown[]) => mockSetFailed(...args),
  info: (...args: unknown[]) => mockInfo(...args),
  warning: (...args: unknown[]) => mockWarning(...args),
}));

// exec mock: calls stdout listener with provided output, returns provided exit code
const mockExec = vi.fn();
vi.mock("@actions/exec", () => ({
  exec: (...args: unknown[]) => mockExec(...args),
}));

// github mock — configurable per test
let mockEventName = "push";
let mockPrNumber: number | undefined = undefined;
const mockCreateComment = vi.fn();
const mockGetOctokit = vi.fn(() => ({
  rest: {
    issues: {
      createComment: mockCreateComment,
    },
  },
}));

vi.mock("@actions/github", () => ({
  context: {
    get eventName() { return mockEventName; },
    get payload() {
      return { pull_request: mockPrNumber !== undefined ? { number: mockPrNumber } : undefined };
    },
    get repo() { return { owner: "scanton", repo: "phase-2-s" }; },
  },
  getOctokit: (...args: unknown[]) => mockGetOctokit(...args),
}));

const mockAppendFileSync = vi.fn();
vi.mock("node:fs", () => ({
  appendFileSync: (...args: unknown[]) => mockAppendFileSync(...args),
}));

// --- Helpers ---

/** Build a default exec mock: installs OK, skill returns the given output + exitCode */
function makeExecMock(skillOutput: string, skillExitCode = 0) {
  return vi.fn(async (
    cmd: string,
    _args: string[],
    opts?: { listeners?: { stdout?: (b: Buffer) => void }; ignoreReturnCode?: boolean }
  ) => {
    if (cmd === "npm") return 0; // install succeeds
    // phase2s run — emit output
    opts?.listeners?.stdout?.(Buffer.from(skillOutput));
    return skillExitCode;
  });
}

/** Default input map */
function defaultInputs(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    skill: "review",
    args: "",
    provider: "anthropic",
    "anthropic-api-key": "sk-ant-test",
    "openai-api-key": "",
    "fail-on": "error",
    ...overrides,
  };
}

function setInputs(inputs: Record<string, string>) {
  mockGetInput.mockImplementation((name: string) => inputs[name] ?? "");
}

// --- Tests ---

describe("Phase2S GitHub Action", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockEventName = "push";
    mockPrNumber = undefined;
    mockCreateComment.mockResolvedValue({});
    delete process.env.GITHUB_STEP_SUMMARY;
    delete process.env.GITHUB_TOKEN;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── 1. Basic run — success path ───────────────────────────────────────────

  it("1: basic success — setOutput called with result and verdict", async () => {
    setInputs(defaultInputs());
    mockExec.mockImplementation(makeExecMock("Looks good."));

    const { run } = await import("../../src/action/index.js");
    await run();

    expect(mockSetOutput).toHaveBeenCalledWith("result", "Looks good.");
    expect(mockSetOutput).toHaveBeenCalledWith("verdict", "");
    expect(mockSetFailed).not.toHaveBeenCalled();
  });

  // ─── 2–3. Skill name normalization ─────────────────────────────────────────

  it("2: skill without leading slash is normalized to /skill", async () => {
    setInputs(defaultInputs({ skill: "review", args: "" }));
    mockExec.mockImplementation(makeExecMock(""));

    const { run } = await import("../../src/action/index.js");
    await run();

    const phase2sCalls = mockExec.mock.calls.filter((c) => c[0] === "phase2s");
    expect(phase2sCalls[0][1]).toContain("/review");
  });

  it("3: skill with leading slash is preserved", async () => {
    setInputs(defaultInputs({ skill: "/review" }));
    mockExec.mockImplementation(makeExecMock(""));

    const { run } = await import("../../src/action/index.js");
    await run();

    const phase2sCalls = mockExec.mock.calls.filter((c) => c[0] === "phase2s");
    expect(phase2sCalls[0][1]).toContain("/review");
    // Should NOT produce "//review"
    expect(phase2sCalls[0][1].join(" ")).not.toContain("//review");
  });

  // ─── 4–5. Args handling ────────────────────────────────────────────────────

  it("4: args are appended to prompt", async () => {
    setInputs(defaultInputs({ skill: "review", args: "src/auth.ts" }));
    mockExec.mockImplementation(makeExecMock(""));

    const { run } = await import("../../src/action/index.js");
    await run();

    const phase2sCalls = mockExec.mock.calls.filter((c) => c[0] === "phase2s");
    expect(phase2sCalls[0][1]).toContain("/review src/auth.ts");
  });

  it("5: no args — prompt is just the skill", async () => {
    setInputs(defaultInputs({ skill: "health", args: "" }));
    mockExec.mockImplementation(makeExecMock(""));

    const { run } = await import("../../src/action/index.js");
    await run();

    const phase2sCalls = mockExec.mock.calls.filter((c) => c[0] === "phase2s");
    expect(phase2sCalls[0][1]).toEqual(["run", "/health"]);
  });

  // ─── 6–9. Verdict extraction ───────────────────────────────────────────────

  it("6: extracts APPROVED verdict", async () => {
    setInputs(defaultInputs());
    mockExec.mockImplementation(makeExecMock("VERDICT: APPROVED\nAll looks good."));

    const { run } = await import("../../src/action/index.js");
    await run();

    expect(mockSetOutput).toHaveBeenCalledWith("verdict", "APPROVED");
  });

  it("7: extracts CHALLENGED verdict", async () => {
    setInputs(defaultInputs());
    mockExec.mockImplementation(makeExecMock("VERDICT: CHALLENGED\nSee objections below."));

    const { run } = await import("../../src/action/index.js");
    await run();

    expect(mockSetOutput).toHaveBeenCalledWith("verdict", "CHALLENGED");
  });

  it("8: extracts NEEDS_CLARIFICATION verdict", async () => {
    setInputs(defaultInputs());
    mockExec.mockImplementation(makeExecMock("VERDICT: NEEDS_CLARIFICATION\nPlease clarify."));

    const { run } = await import("../../src/action/index.js");
    await run();

    expect(mockSetOutput).toHaveBeenCalledWith("verdict", "NEEDS_CLARIFICATION");
  });

  it("9: no verdict in output — verdict output is empty string", async () => {
    setInputs(defaultInputs());
    mockExec.mockImplementation(makeExecMock("No structured verdict here."));

    const { run } = await import("../../src/action/index.js");
    await run();

    expect(mockSetOutput).toHaveBeenCalledWith("verdict", "");
  });

  // ─── 10–14. fail-on logic ──────────────────────────────────────────────────

  it("10: fail-on=error, exitCode=1 → setFailed called", async () => {
    setInputs(defaultInputs({ "fail-on": "error" }));
    mockExec.mockImplementation(makeExecMock("Error output.", 1));

    const { run } = await import("../../src/action/index.js");
    await run();

    expect(mockSetFailed).toHaveBeenCalledWith(expect.stringContaining("exit: 1"));
  });

  it("11: fail-on=error, exitCode=0 → setFailed NOT called", async () => {
    setInputs(defaultInputs({ "fail-on": "error" }));
    mockExec.mockImplementation(makeExecMock("All good.", 0));

    const { run } = await import("../../src/action/index.js");
    await run();

    expect(mockSetFailed).not.toHaveBeenCalled();
  });

  it("12: fail-on=challenged, verdict=CHALLENGED, exitCode=0 → setFailed called", async () => {
    setInputs(defaultInputs({ "fail-on": "challenged" }));
    mockExec.mockImplementation(makeExecMock("VERDICT: CHALLENGED\nObjections.", 0));

    const { run } = await import("../../src/action/index.js");
    await run();

    expect(mockSetFailed).toHaveBeenCalledWith(expect.stringContaining("CHALLENGED"));
  });

  it("13: fail-on=challenged, verdict=APPROVED, exitCode=0 → setFailed NOT called", async () => {
    setInputs(defaultInputs({ "fail-on": "challenged" }));
    mockExec.mockImplementation(makeExecMock("VERDICT: APPROVED\nLooks good.", 0));

    const { run } = await import("../../src/action/index.js");
    await run();

    expect(mockSetFailed).not.toHaveBeenCalled();
  });

  it("14: fail-on=never, exitCode=1 → setFailed NOT called", async () => {
    setInputs(defaultInputs({ "fail-on": "never" }));
    mockExec.mockImplementation(makeExecMock("Something broke.", 1));

    const { run } = await import("../../src/action/index.js");
    await run();

    expect(mockSetFailed).not.toHaveBeenCalled();
  });

  // ─── 15–17. Step Summary ──────────────────────────────────────────────────

  it("15: GITHUB_STEP_SUMMARY set — writes markdown with skill name and output", async () => {
    process.env.GITHUB_STEP_SUMMARY = "/tmp/summary.md";
    setInputs(defaultInputs({ skill: "health" }));
    mockExec.mockImplementation(makeExecMock("Health check passed."));

    const { run } = await import("../../src/action/index.js");
    await run();

    expect(mockAppendFileSync).toHaveBeenCalledWith(
      "/tmp/summary.md",
      expect.stringContaining("Phase2S: `/health`")
    );
    expect(mockAppendFileSync).toHaveBeenCalledWith(
      "/tmp/summary.md",
      expect.stringContaining("Health check passed.")
    );
  });

  it("16: GITHUB_STEP_SUMMARY not set — appendFileSync not called", async () => {
    delete process.env.GITHUB_STEP_SUMMARY;
    setInputs(defaultInputs());
    mockExec.mockImplementation(makeExecMock("Output."));

    const { run } = await import("../../src/action/index.js");
    await run();

    expect(mockAppendFileSync).not.toHaveBeenCalled();
  });

  it("17: GITHUB_STEP_SUMMARY includes verdict when present", async () => {
    process.env.GITHUB_STEP_SUMMARY = "/tmp/summary.md";
    setInputs(defaultInputs());
    mockExec.mockImplementation(makeExecMock("VERDICT: APPROVED\nAll clear."));

    const { run } = await import("../../src/action/index.js");
    await run();

    expect(mockAppendFileSync).toHaveBeenCalledWith(
      "/tmp/summary.md",
      expect.stringContaining("**Verdict:** APPROVED")
    );
  });

  // ─── 18–19. PR comments ───────────────────────────────────────────────────

  it("18: pull_request event + GITHUB_TOKEN → posts PR comment", async () => {
    process.env.GITHUB_TOKEN = "ghs_token";
    mockEventName = "pull_request";
    mockPrNumber = 42;
    setInputs(defaultInputs());
    mockExec.mockImplementation(makeExecMock("Review output."));

    const { run } = await import("../../src/action/index.js");
    await run();

    expect(mockCreateComment).toHaveBeenCalledWith(
      expect.objectContaining({ issue_number: 42 })
    );
  });

  it("19: push event — PR comment NOT posted", async () => {
    process.env.GITHUB_TOKEN = "ghs_token";
    mockEventName = "push";
    setInputs(defaultInputs());
    mockExec.mockImplementation(makeExecMock("Output."));

    const { run } = await import("../../src/action/index.js");
    await run();

    expect(mockCreateComment).not.toHaveBeenCalled();
  });

  // ─── 20. Env vars ─────────────────────────────────────────────────────────

  it("20: ANTHROPIC_API_KEY and NO_COLOR=1 passed in exec env", async () => {
    setInputs(defaultInputs({ "anthropic-api-key": "sk-ant-real-key" }));
    mockExec.mockImplementation(makeExecMock(""));

    const { run } = await import("../../src/action/index.js");
    await run();

    const phase2sCalls = mockExec.mock.calls.filter((c) => c[0] === "phase2s");
    const env = phase2sCalls[0][2]?.env as Record<string, string>;
    expect(env.NO_COLOR).toBe("1");
    expect(env.ANTHROPIC_API_KEY).toBe("sk-ant-real-key");
  });

  // ─── 21–22. Auto-install ──────────────────────────────────────────────────

  it("21: auto-install — npm install -g @scanton/phase2s called before skill", async () => {
    setInputs(defaultInputs());
    const callOrder: string[] = [];
    mockExec.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === "npm") { callOrder.push("install"); return 0; }
      if (cmd === "phase2s") { callOrder.push("skill"); return 0; }
      return 0;
    });

    const { run } = await import("../../src/action/index.js");
    await run();

    const npmCalls = mockExec.mock.calls.filter((c) => c[0] === "npm");
    expect(npmCalls[0][1]).toEqual(["install", "-g", "@scanton/phase2s"]);
    expect(callOrder[0]).toBe("install");
    expect(callOrder[1]).toBe("skill");
  });

  it("22: auto-install fails → setFailed immediately, skill never runs", async () => {
    setInputs(defaultInputs());
    mockExec.mockImplementation(async (cmd: string) => {
      if (cmd === "npm") return 1; // install fails
      return 0;
    });

    const { run } = await import("../../src/action/index.js");
    await run();

    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining("Failed to install @scanton/phase2s")
    );
    const phase2sCalls = mockExec.mock.calls.filter((c) => c[0] === "phase2s");
    expect(phase2sCalls).toHaveLength(0);
  });

  // ─── 23. Comment truncation ───────────────────────────────────────────────

  it("23: output > 60000 chars — PR comment is truncated with note", async () => {
    process.env.GITHUB_TOKEN = "ghs_token";
    mockEventName = "pull_request";
    mockPrNumber = 1;
    const longOutput = "x".repeat(65_000);
    setInputs(defaultInputs());
    mockExec.mockImplementation(makeExecMock(longOutput));

    const { run } = await import("../../src/action/index.js");
    await run();

    const commentBody = mockCreateComment.mock.calls[0][0].body as string;
    expect(commentBody.length).toBeLessThan(65_000);
    expect(commentBody).toContain("output truncated");
    expect(commentBody).toContain("Step Summary");
  });

  // ─── 24. Comment error → warning ──────────────────────────────────────────

  it("24: createComment throws → core.warning called, setFailed NOT called (from comment)", async () => {
    process.env.GITHUB_TOKEN = "ghs_token";
    mockEventName = "pull_request";
    mockPrNumber = 7;
    setInputs(defaultInputs());
    mockExec.mockImplementation(makeExecMock("Skill output.", 0));
    mockCreateComment.mockRejectedValue(new Error("Resource not accessible by integration"));

    const { run } = await import("../../src/action/index.js");
    await run();

    expect(mockWarning).toHaveBeenCalledWith(
      expect.stringContaining("Could not post PR comment")
    );
    // setFailed was NOT called because of the comment error
    const failedCalls = mockSetFailed.mock.calls.filter((c) =>
      String(c[0]).includes("PR comment") || String(c[0]).includes("comment")
    );
    expect(failedCalls).toHaveLength(0);
  });
});
