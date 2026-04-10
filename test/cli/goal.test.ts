import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildSatoriContext, buildAdversarialPrompt, checkCriteria, runCommand, runGoal } from "../../src/cli/goal.js";
import { computeSpecHash, readState, writeState } from "../../src/core/state.js";
import type { SubTask, Spec } from "../../src/core/spec-parser.js";
import { Agent } from "../../src/core/agent.js";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Top-level mocks for runGoal integration tests
// ---------------------------------------------------------------------------

// Use vi.hoisted so we can mutate mockReviewResponse between tests.
const mockReviewResponse = vi.hoisted(() => ({
  value: "VERDICT: CHALLENGED\nSTRONGEST_CONCERN: Spec is too vague.\nOBJECTIONS:\n1. No concrete test.\nAPPROVE_IF: Add specific tests.",
}));

vi.mock("../../src/core/config.js", () => ({
  loadConfig: vi.fn().mockResolvedValue({
    provider: "codex-cli",
    model: "gpt-4o",
    maxTurns: 50,
    timeout: 120_000,
    allowDestructive: false,
    verifyCommand: "npm test",
    requireSpecification: false,
    codexPath: "codex",
  }),
}));

vi.mock("../../src/core/memory.js", () => ({
  loadLearnings: vi.fn().mockResolvedValue([]),
  formatLearningsForPrompt: vi.fn().mockReturnValue(""),
}));

vi.mock("../../src/core/agent.js", () => {
  class MockAgent {
    run = vi.fn().mockImplementation(() => Promise.resolve(mockReviewResponse.value));
    getConversation() { return {}; }
  }
  return { Agent: MockAgent };
});

vi.mock("../../src/skills/index.js", () => ({
  loadAllSkills: vi.fn().mockResolvedValue([
    { name: "adversarial", description: "adversarial", model: "smart", promptTemplate: "Review it now.", triggers: [] },
    { name: "satori", description: "satori", model: "smart", promptTemplate: "Implement it.", retries: 3, triggers: [] },
  ]),
}));

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
  });

  it("includes reflection protocol after the failure context", () => {
    const prompt = buildSatoriContext(SUBTASK, CONSTRAINTS, "The bucket wasn't cleared on window expiry");
    const failureIdx = prompt.indexOf("## Previous failure");
    const reflectionIdx = prompt.indexOf("## Reflection protocol");
    expect(reflectionIdx).toBeGreaterThan(failureIdx);
    expect(prompt).toContain("Getting stuck is acceptable");
  });

  it("does NOT include reflection protocol when failureContext is absent", () => {
    const prompt = buildSatoriContext(SUBTASK, CONSTRAINTS);
    expect(prompt).not.toContain("Reflection protocol");
    expect(prompt).not.toContain("Getting stuck is acceptable");
  });

  it("falls back to one-liner when PHASE2S_DOOM_LOOP_REFLECTION=off", () => {
    const prev = process.env.PHASE2S_DOOM_LOOP_REFLECTION;
    process.env.PHASE2S_DOOM_LOOP_REFLECTION = "off";
    try {
      const prompt = buildSatoriContext(SUBTASK, CONSTRAINTS, "The bucket wasn't cleared on window expiry");
      expect(prompt).toContain("Fix this specifically. Do not repeat the same approach.");
      expect(prompt).not.toContain("Reflection protocol");
    } finally {
      if (prev === undefined) {
        delete process.env.PHASE2S_DOOM_LOOP_REFLECTION;
      } else {
        process.env.PHASE2S_DOOM_LOOP_REFLECTION = prev;
      }
    }
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

// ---------------------------------------------------------------------------
// runGoal — throws Error on missing spec file (no process.exit)
// ---------------------------------------------------------------------------

describe("runGoal — missing spec file throws Error", () => {
  it("throws Error (not process.exit) when spec file does not exist", async () => {
    await expect(runGoal("/nonexistent/path/to/spec.md")).rejects.toThrow(
      /Cannot read spec file/,
    );
  });
});

// ---------------------------------------------------------------------------
// buildAdversarialPrompt
// ---------------------------------------------------------------------------

describe("buildAdversarialPrompt", () => {
  const SPEC: Spec = {
    title: "Add rate limiting",
    problemStatement: "The API has no rate limiting and is vulnerable to abuse.",
    decomposition: [
      { name: "Token bucket implementation", successCriteria: "Unit tests pass", input: "Request", output: "RateLimiter class" },
      { name: "Middleware integration", successCriteria: "Returns 429 on exceed", input: "Express app", output: "Wired middleware" },
    ],
    acceptanceCriteria: [
      "100 requests per minute per user",
      "Returns 429 on exceed",
    ],
    evalCommand: "npm test",
    constraints: { mustDo: [], cannotDo: [], shouldPrefer: [], shouldEscalate: [] },
  };

  it("includes sub-task decomposition names", () => {
    const prompt = buildAdversarialPrompt(SPEC, "Review it now.");
    expect(prompt).toContain("Token bucket implementation");
    expect(prompt).toContain("Middleware integration");
  });

  it("includes acceptance criteria", () => {
    const prompt = buildAdversarialPrompt(SPEC, "Review it now.");
    expect(prompt).toContain("100 requests per minute per user");
    expect(prompt).toContain("Returns 429 on exceed");
  });

  it("appends the adversarial template after the plan", () => {
    const template = "ADVERSARIAL_TEMPLATE_MARKER";
    const prompt = buildAdversarialPrompt(SPEC, template);
    const planIdx = prompt.indexOf("Token bucket");
    const templateIdx = prompt.indexOf("ADVERSARIAL_TEMPLATE_MARKER");
    expect(planIdx).toBeGreaterThanOrEqual(0);
    expect(templateIdx).toBeGreaterThan(planIdx);
  });

  it("works when adversarial template is empty string", () => {
    const prompt = buildAdversarialPrompt(SPEC, "");
    expect(prompt).toContain("Token bucket implementation");
  });
});

// ---------------------------------------------------------------------------
// runGoal — pre-execution adversarial review
// ---------------------------------------------------------------------------

// Minimal spec markdown that parseSpec can handle
const MINIMAL_SPEC_MD = `# Test Feature

## Problem Statement
A simple test.

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
- Cannot do: break things
`;

describe("runGoal — reviewBeforeRun with CHALLENGED verdict", () => {
  let tmpDir: string;
  let specPath: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `phase2s-goal-review-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    specPath = join(tmpDir, "spec.md");
    writeFileSync(specPath, MINIMAL_SPEC_MD, "utf8");
    // Reset to CHALLENGED response before each test
    mockReviewResponse.value =
      "VERDICT: CHALLENGED\nSTRONGEST_CONCERN: Spec is too vague.\nOBJECTIONS:\n1. No concrete test.\nAPPROVE_IF: Add specific tests.";
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns challenged: true and no sub-tasks run when verdict is CHALLENGED", async () => {
    const result = await runGoal(specPath, { reviewBeforeRun: true });
    expect(result.challenged).toBe(true);
    expect(result.success).toBe(false);
    expect(result.attempts).toBe(0);
    expect(result.challengeResponse).toContain("VERDICT: CHALLENGED");
    expect(result.summary).toContain("CHALLENGED");
    expect(typeof result.runLogPath).toBe("string");
  });

  it("returns challenged: true when verdict is NEEDS_CLARIFICATION (same halt behavior)", async () => {
    // Override mock response to NEEDS_CLARIFICATION for this test
    mockReviewResponse.value =
      "VERDICT: NEEDS_CLARIFICATION\nSTRONGEST_CONCERN: Missing context.\nOBJECTIONS:\n1. What is the scope?\nAPPROVE_IF: Clarify scope.";

    const result = await runGoal(specPath, { reviewBeforeRun: true });
    expect(result.challenged).toBe(true);
    expect(result.success).toBe(false);
    expect(result.attempts).toBe(0);
    expect(result.challengeResponse).toContain("NEEDS_CLARIFICATION");
  });
});

// ---------------------------------------------------------------------------
// runGoal — dry-run mode
// ---------------------------------------------------------------------------

describe("runGoal — dryRun: true", () => {
  let tmpDir: string;
  let specPath: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `phase2s-goal-dryrun-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    specPath = join(tmpDir, "spec.md");
    writeFileSync(specPath, MINIMAL_SPEC_MD, "utf8");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns dryRun:true and attempts:0 without calling the agent", async () => {
    const result = await runGoal(specPath, { dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.attempts).toBe(0);
    expect(result.success).toBe(true);
    expect(result.runLogPath).toBe("");
    expect(result.summary).toContain("Dry run");
  });

  it("does not call Agent when dryRun is true", async () => {
    // Agent is already mocked at top of file — reset call tracking
    const AgentMock = (await import("../../src/core/agent.js")).Agent as unknown as { mock: { instances: unknown[] } };
    const instancesBefore = AgentMock.mock?.instances?.length ?? 0;

    await runGoal(specPath, { dryRun: true });

    // Agent should not have been instantiated at all during a dry run
    const instancesAfter = AgentMock.mock?.instances?.length ?? 0;
    expect(instancesAfter).toBe(instancesBefore);
  });

  it("prints decomposition tree to console when dryRun is true", async () => {
    // Write a spec that parses correctly (## Decomposition + ### Sub-task N: Name format)
    const specWithSubtasks = `# Test Feature

## Problem Statement
A simple test.

## Decomposition
### Sub-task 1: Token bucket implementation
- **Input:** Request with user ID
- **Output:** RateLimiter class
- **Success criteria:** Unit tests pass

## Acceptance Criteria
- It works

## Eval Command
\`\`\`
echo done
\`\`\`
`;
    writeFileSync(specPath, specWithSubtasks, "utf8");

    const logMessages: string[] = [];
    const consoleSpy = vi.spyOn(console, "log").mockImplementation((msg: unknown) => {
      logMessages.push(String(msg));
    });

    await runGoal(specPath, { dryRun: true });
    consoleSpy.mockRestore();

    const output = logMessages.join("\n");
    expect(output).toContain("Sub-tasks (1)");
    expect(output).toContain("Token bucket implementation");
  });
});
