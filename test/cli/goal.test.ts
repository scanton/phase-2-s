import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildSatoriContext, checkCriteria, runCommand } from "../../src/cli/goal.js";
import type { SubTask, Spec } from "../../src/core/spec-parser.js";
import { Agent } from "../../src/core/agent.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SUBTASK: SubTask = {
  name: "Token bucket implementation",
  input: "Request with user ID",
  output: "RateLimiter class",
  successCriteria: "Unit tests for bucket fill/drain pass",
};

const CONSTRAINTS: Spec["constraints"] = {
  mustDo: ["Use in-memory store"],
  cannotDo: ["Redis backend"],
  shouldPrefer: ["Token bucket"],
  shouldEscalate: [],
};

// ---------------------------------------------------------------------------
// buildSatoriContext
// ---------------------------------------------------------------------------

describe("buildSatoriContext", () => {
  it("includes subtask success criteria", () => {
    const prompt = buildSatoriContext(SUBTASK, CONSTRAINTS);
    expect(prompt).toContain("Unit tests for bucket fill/drain pass");
  });

  it("includes input and output from subtask", () => {
    const prompt = buildSatoriContext(SUBTASK, CONSTRAINTS);
    expect(prompt).toContain("Request with user ID");
    expect(prompt).toContain("RateLimiter class");
  });

  it("includes constraints", () => {
    const prompt = buildSatoriContext(SUBTASK, CONSTRAINTS);
    expect(prompt).toContain("Use in-memory store");
    expect(prompt).toContain("Redis backend");
  });

  it("does NOT include previous failure section on first attempt", () => {
    const prompt = buildSatoriContext(SUBTASK, CONSTRAINTS);
    expect(prompt).not.toContain("Previous failure");
  });

  it("includes previous failure section on retry", () => {
    const prompt = buildSatoriContext(SUBTASK, CONSTRAINTS, "The bucket wasn't cleared on window expiry");
    expect(prompt).toContain("Previous failure");
    expect(prompt).toContain("The bucket wasn't cleared on window expiry");
    expect(prompt).toContain("Fix this specifically");
  });
});

// ---------------------------------------------------------------------------
// checkCriteria
// ---------------------------------------------------------------------------

describe("checkCriteria", () => {
  let agent: { run: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    agent = { run: vi.fn() };
  });

  it("returns true for PASS lines", async () => {
    agent.run.mockResolvedValue(
      "PASS: Authenticated users: 100 requests per minute, 429 on exceed\nPASS: npm test passes after implementation",
    );
    const criteria = [
      "Authenticated users: 100 requests per minute, 429 on exceed",
      "npm test passes after implementation",
    ];
    const results = await checkCriteria(criteria, "test output", agent as unknown as Agent);
    expect(results["Authenticated users: 100 requests per minute, 429 on exceed"]).toBe(true);
    expect(results["npm test passes after implementation"]).toBe(true);
  });

  it("returns false for FAIL lines", async () => {
    agent.run.mockResolvedValue(
      "FAIL: Authenticated users: 100 requests per minute, 429 on exceed — bucket not resetting\nPASS: npm test passes after implementation",
    );
    const criteria = [
      "Authenticated users: 100 requests per minute, 429 on exceed",
      "npm test passes after implementation",
    ];
    const results = await checkCriteria(criteria, "test output", agent as unknown as Agent);
    expect(results["Authenticated users: 100 requests per minute, 429 on exceed"]).toBe(false);
    expect(results["npm test passes after implementation"]).toBe(true);
  });

  it("defaults to false when model response is unparseable", async () => {
    agent.run.mockResolvedValue("I'm not sure, the output looks mixed.");
    const criteria = ["All tests pass"];
    const results = await checkCriteria(criteria, "test output", agent as unknown as Agent);
    expect(results["All tests pass"]).toBe(false);
  });

  it("truncates eval output to 4000 chars before sending to model", async () => {
    agent.run.mockResolvedValue("PASS: All tests pass");
    const longOutput = "x".repeat(10_000);
    await checkCriteria(["All tests pass"], longOutput, agent as unknown as Agent);
    const prompt = agent.run.mock.calls[0][0] as string;
    // The prompt should contain the truncated output, not the full 10k string
    expect(prompt.length).toBeLessThan(10_000);
  });
});

// ---------------------------------------------------------------------------
// runCommand
// ---------------------------------------------------------------------------

describe("runCommand", () => {
  it("captures stdout from a successful command", async () => {
    const output = await runCommand("echo hello");
    expect(output.trim()).toBe("hello");
  });

  it("returns output even when command exits non-zero", async () => {
    const output = await runCommand("echo 'test output' && exit 1");
    expect(output).toContain("test output");
  });

  it("returns timeout message when command exceeds timeout", async () => {
    const output = await runCommand("sleep 10", 100); // 100ms timeout
    expect(output).toContain("EVAL TIMEOUT");
  });
});
