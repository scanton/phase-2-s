/**
 * Tests for handleRunGoalCase — the extracted :goal REPL handler.
 *
 * Covers the reentrancy guard, all four success-path branches, and the two
 * error-catch branches (RateLimitError with/without retryAfter, generic Error).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleRunGoalCase } from "../../src/cli/index.js";
import { RateLimitError } from "../../src/core/rate-limit-error.js";
import type { GoalResult } from "../../src/cli/goal.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResult(overrides: Partial<GoalResult> = {}): GoalResult {
  return {
    success: true,
    attempts: 1,
    criteriaResults: {},
    runLogPath: "/tmp/run.jsonl",
    summary: "ok",
    durationMs: 1500,
    ...overrides,
  };
}

function makeState(running = false): { running: boolean } {
  return { running };
}

// Capture console.log calls as plain strings (strip ANSI escapes for assertions).
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1B\[[0-9;]*m/g, "");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("handleRunGoalCase — reentrancy guard", () => {
  let logs: string[];
  beforeEach(() => {
    logs = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(String(args[0] ?? ""));
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("prints warning and does NOT call runGoalFn when already running", async () => {
    const state = makeState(true);
    const runGoalFn = vi.fn().mockResolvedValue(makeResult());

    await handleRunGoalCase("specs/auth.md", state, undefined, runGoalFn);

    expect(runGoalFn).not.toHaveBeenCalled();
    const combined = logs.map(stripAnsi).join("\n");
    expect(combined).toContain("A goal is already running");
  });

  it("leaves state.running true after the warning (caller already set it)", async () => {
    const state = makeState(true);
    const runGoalFn = vi.fn().mockResolvedValue(makeResult());
    await handleRunGoalCase("specs/auth.md", state, undefined, runGoalFn);
    expect(state.running).toBe(true);
  });
});

describe("handleRunGoalCase — success paths", () => {
  let logs: string[];
  beforeEach(() => {
    logs = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(String(args[0] ?? ""));
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("prints 'Goal complete' on success and resets state.running to false", async () => {
    const state = makeState();
    const runGoalFn = vi.fn().mockResolvedValue(makeResult({ success: true, durationMs: 2300 }));

    await handleRunGoalCase("specs/auth.md", state, undefined, runGoalFn);

    const combined = logs.map(stripAnsi).join("\n");
    expect(combined).toContain("Goal complete in 2.3s");
    expect(state.running).toBe(false);
  });

  it("prints 'Goal failed' when success=false", async () => {
    const state = makeState();
    const runGoalFn = vi.fn().mockResolvedValue(makeResult({ success: false, attempts: 3 }));

    await handleRunGoalCase("specs/auth.md", state, undefined, runGoalFn);

    const combined = logs.map(stripAnsi).join("\n");
    expect(combined).toContain("Goal failed after 3 attempt(s)");
  });

  it("prints 'Goal run challenged' when challenged=true", async () => {
    const state = makeState();
    const runGoalFn = vi.fn().mockResolvedValue(makeResult({ challenged: true }));

    await handleRunGoalCase("specs/auth.md", state, undefined, runGoalFn);

    const combined = logs.map(stripAnsi).join("\n");
    expect(combined).toContain("Goal run challenged by adversarial review");
  });

  it("prints 'Dry run complete' when dryRun=true", async () => {
    const state = makeState();
    const runGoalFn = vi.fn().mockResolvedValue(makeResult({ dryRun: true }));

    await handleRunGoalCase("specs/auth.md", state, undefined, runGoalFn);

    const combined = logs.map(stripAnsi).join("\n");
    expect(combined).toContain("Dry run complete");
  });

  it("passes reasoningOverride to runGoalFn", async () => {
    const state = makeState();
    const runGoalFn = vi.fn().mockResolvedValue(makeResult());

    await handleRunGoalCase("specs/auth.md", state, "high", runGoalFn);

    expect(runGoalFn).toHaveBeenCalledWith("specs/auth.md", {
      throwOnRateLimit: true,
      reasoningEffort: "high",
    });
  });
});

describe("handleRunGoalCase — RateLimitError catch", () => {
  let logs: string[];
  beforeEach(() => {
    logs = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(String(args[0] ?? ""));
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("prints rate-limit message with retryAfter and resets state.running", async () => {
    const state = makeState();
    const err = new RateLimitError(60);
    (err as RateLimitError & { providerName?: string }).providerName = "openai";
    const runGoalFn = vi.fn().mockRejectedValue(err);

    await handleRunGoalCase("specs/auth.md", state, undefined, runGoalFn);

    const combined = logs.map(stripAnsi).join("\n");
    expect(combined).toContain("Goal paused");
    expect(combined).toContain("rate limited by openai");
    expect(combined).toContain("Rate limit resets in ~60s");
    expect(combined).toContain("Re-run :goal to resume");
    expect(state.running).toBe(false);
  });

  it("prints rate-limit message without retryAfter when retryAfter is undefined", async () => {
    const state = makeState();
    const err = new RateLimitError(undefined);
    const runGoalFn = vi.fn().mockRejectedValue(err);

    await handleRunGoalCase("specs/auth.md", state, undefined, runGoalFn);

    const combined = logs.map(stripAnsi).join("\n");
    expect(combined).toContain("Goal paused");
    expect(combined).not.toContain("resets in");
    expect(state.running).toBe(false);
  });

  it("uses 'provider' fallback when providerName is undefined", async () => {
    const state = makeState();
    const err = new RateLimitError(30);
    const runGoalFn = vi.fn().mockRejectedValue(err);

    await handleRunGoalCase("specs/auth.md", state, undefined, runGoalFn);

    const combined = logs.map(stripAnsi).join("\n");
    expect(combined).toContain("rate limited by provider");
  });
});

describe("handleRunGoalCase — generic error catch", () => {
  let logs: string[];
  beforeEach(() => {
    logs = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(String(args[0] ?? ""));
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("prints Goal error message and resets state.running", async () => {
    const state = makeState();
    const runGoalFn = vi.fn().mockRejectedValue(new Error("spec file not found"));

    await handleRunGoalCase("specs/missing.md", state, undefined, runGoalFn);

    const combined = logs.map(stripAnsi).join("\n");
    expect(combined).toContain("Goal error: spec file not found");
    expect(state.running).toBe(false);
  });

  it("handles non-Error throws by stringifying them", async () => {
    const state = makeState();
    const runGoalFn = vi.fn().mockRejectedValue("bare string error");

    await handleRunGoalCase("specs/auth.md", state, undefined, runGoalFn);

    const combined = logs.map(stripAnsi).join("\n");
    expect(combined).toContain("Goal error: bare string error");
  });
});
