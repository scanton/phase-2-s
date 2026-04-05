import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildSatoriContext, checkCriteria, runCommand } from "../../src/cli/goal.js";
import { computeSpecHash, readState, writeState } from "../../src/core/state.js";
import type { SubTask, Spec } from "../../src/core/spec-parser.js";
import { Agent } from "../../src/core/agent.js";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

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

// ---------------------------------------------------------------------------
// Goal state + resume integration
// ---------------------------------------------------------------------------

describe("goal state — computeSpecHash is stable", () => {
  it("same content produces same hash", () => {
    const content = "# My Spec\n\nBuild something great.";
    expect(computeSpecHash(content)).toBe(computeSpecHash(content));
  });

  it("different content produces different hash", () => {
    expect(computeSpecHash("spec v1")).not.toBe(computeSpecHash("spec v2"));
  });
});

describe("goal state — writeState marks sub-task passed and readState recovers it", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `phase2s-goal-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("persists a passed sub-task result and retrieves it", () => {
    const hash = computeSpecHash("spec content");
    const state = {
      specFile: "spec.md",
      specHash: hash,
      startedAt: "2026-04-05T10:00:00Z",
      lastUpdatedAt: "2026-04-05T10:05:00Z",
      maxAttempts: 3,
      attempt: 1,
      subTaskResults: {
        "0": { status: "passed" as const, completedAt: "2026-04-05T10:05:00Z" },
      },
    };
    writeState(tmpDir, hash, state);
    const loaded = readState(tmpDir, hash);
    expect(loaded?.subTaskResults["0"]?.status).toBe("passed");
  });

  it("persists a failed sub-task with failureContext", () => {
    const hash = computeSpecHash("spec content for failure");
    const state = {
      specFile: "spec.md",
      specHash: hash,
      startedAt: "2026-04-05T10:00:00Z",
      lastUpdatedAt: "2026-04-05T10:10:00Z",
      maxAttempts: 3,
      attempt: 1,
      subTaskResults: {
        "1": { status: "failed" as const, failureContext: "TypeError: cannot read property", attempts: 1 },
      },
    };
    writeState(tmpDir, hash, state);
    const loaded = readState(tmpDir, hash);
    expect(loaded?.subTaskResults["1"]?.status).toBe("failed");
    expect(loaded?.subTaskResults["1"]?.failureContext).toBe("TypeError: cannot read property");
    expect(loaded?.subTaskResults["1"]?.attempts).toBe(1);
  });

  it("readState returns null when no prior state exists (--resume with fresh spec)", () => {
    const result = readState(tmpDir, "unknown-hash-no-file");
    // This is the --resume fresh-start case: null means start over silently.
    expect(result).toBeNull();
  });
});
