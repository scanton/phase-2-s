/**
 * Tests for the Sprint 86 conductor: conductorGenSpec() + runConduct().
 *
 * Coverage:
 *  1. conductorGenSpec — valid spec generated and saved to disk
 *  2. conductorGenSpec — retry: first invalid, second valid
 *  3. conductorGenSpec — provider throws → empty specPath
 *  4. conductorGenSpec (D4) — retry-fails: both calls invalid → empty specPath
 *  5. conductorGenSpec (D5) — AbortController fires → catch → empty specPath
 *  6. runConduct — dry-run stops before runGoal
 *  7. runConduct — non-TTY skips confirm, calls runGoal
 *  8. runConduct (D6) — TTY + --yes skips confirm, calls runGoal
 *  9. CONDUCT_TOOL dispatch — handleRequest routes goal → conduct tool
 * 10. runConduct — empty specPath → exitCode=1, no runGoal
 * 11. handleRequest — missing goal → -32602 error
 * 12. handleRequest — spec gen failure → -32603 error
 * 13. handleRequest — dryRun=true → returns spec preview without runGoal
 * 14. buildConductorContext — non-git dir returns "unknown" branch
 * 15. buildConductorContext — output is capped at CONTEXT_MAX_BYTES
 * 16. runConduct — --output path writes JSON summary file
 * 17. runConduct — TTY + 'n' answer declines run, no runGoal call
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { conductorGenSpec } from "../../src/cli/conductor-prompt.js";

// ---------------------------------------------------------------------------
// Hoisted constants — accessible inside vi.mock() factories
// ---------------------------------------------------------------------------

const { VALID_SPEC, INVALID_SPEC, MOCK_CONFIG } = vi.hoisted(() => {
  const VALID_SPEC = `# Add rate limiting

## Problem Statement
Add per-user rate limiting to the API to prevent abuse.

## Decomposition

### Sub-task 1: Architect rate limiting design
**Role:** architect
- **Files:** arch-plan.md
- **Input:** Goal description
- **Output:** arch-plan.md
- **Success criteria:** arch-plan.md exists with implementation plan

### Sub-task 2: Implement rate limiter
**Role:** implementer
- **Files:** src/middleware/rate-limiter.ts
- **Input:** arch-plan.md
- **Output:** rate-limiter.ts
- **Success criteria:** All unit tests pass

## Eval Command
npm test

## Acceptance Criteria
- Rate limiting middleware is implemented
- All acceptance criteria met
- Eval command exits 0
`;

  const INVALID_SPEC = `# Broken Spec

Some random text with no proper sections.
`;

  const MOCK_CONFIG = {
    provider: "openai-api" as const,
    model: "gpt-4o",
    smart_model: "gpt-4o",
    maxTurns: 50,
    timeout: 120_000,
    verifyCommand: "npm test",
    requireSpecification: false,
  };

  return { VALID_SPEC, INVALID_SPEC, MOCK_CONFIG };
});

// ---------------------------------------------------------------------------
// Global mocks
// ---------------------------------------------------------------------------

vi.mock("../../src/core/config.js", () => ({
  loadConfig: vi.fn().mockResolvedValue(MOCK_CONFIG),
}));

// ---------------------------------------------------------------------------
// readline mock — needed for TTY confirmation test (ESM modules cannot be
// spied on with vi.spyOn; must use vi.mock at the top level instead).
// ---------------------------------------------------------------------------

const mockReadlineAnswer = { value: "y" }; // mutated per-test

vi.mock("node:readline", () => ({
  createInterface: vi.fn(() => ({
    question: vi.fn((_q: string, cb: (answer: string) => void) => cb(mockReadlineAnswer.value)),
    close: vi.fn(),
  })),
}));

// Silence buildConductorContext (no real git in tests)
vi.mock("../../src/cli/conductor-prompt.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/cli/conductor-prompt.js")>();
  return {
    ...original,
    buildConductorContext: vi.fn().mockResolvedValue("Branch: main\nRecent commits:\nabc123 feat: init"),
  };
});

// Mock runGoal so tests don't run real agents
const mockRunGoalResult = {
  success: true,
  attempts: 1,
  criteriaResults: { "Rate limiting middleware is implemented": true },
  runLogPath: "/tmp/fake-run.jsonl",
  summary: "All criteria passed.",
  durationMs: 1000,
};

vi.mock("../../src/cli/goal.js", () => ({
  runGoal: vi.fn().mockResolvedValue(mockRunGoalResult),
}));

// ---------------------------------------------------------------------------
// Provider factories (inject via options._provider — no module mocking needed)
// ---------------------------------------------------------------------------

function validProvider() {
  return {
    name: "mock",
    chatStream: vi.fn().mockImplementation(async function* () {
      yield { type: "text" as const, content: VALID_SPEC };
      yield { type: "done" as const, stopReason: "end_turn" };
    }),
  };
}

function errorProvider() {
  return {
    name: "mock",
    chatStream: vi.fn().mockImplementation(async function* () {
      throw new Error("Network failure");
      // eslint-disable-next-line no-unreachable
      yield { type: "done" as const, stopReason: "end_turn" };
    }),
  };
}

function retryProvider() {
  let callCount = 0;
  return {
    name: "mock",
    chatStream: vi.fn().mockImplementation(async function* () {
      callCount++;
      const text = callCount === 1 ? INVALID_SPEC : VALID_SPEC;
      yield { type: "text" as const, content: text };
      yield { type: "done" as const, stopReason: "end_turn" };
    }),
  };
}

function alwaysInvalidProvider() {
  return {
    name: "mock",
    chatStream: vi.fn().mockImplementation(async function* () {
      yield { type: "text" as const, content: INVALID_SPEC };
      yield { type: "done" as const, stopReason: "end_turn" };
    }),
  };
}

function hangingProvider() {
  return {
    name: "mock",
    chatStream: vi.fn().mockImplementation(
      async function* (_messages: unknown, _tools: unknown, options?: { signal?: AbortSignal }) {
        if (options?.signal?.aborted) return;
        await new Promise<void>((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(new Error("AbortError")));
        });
      },
    ),
  };
}

// ---------------------------------------------------------------------------
// conductorGenSpec tests
// ---------------------------------------------------------------------------

describe("conductorGenSpec()", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "conduct-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("1. saves a valid spec to disk and returns a non-empty specPath", async () => {
    const result = await conductorGenSpec("add rate limiting", MOCK_CONFIG, {
      cwd: tmpDir,
      _provider: validProvider(),
    });

    expect(result.specPath).not.toBe("");
    expect(result.specContent).toContain("# Add rate limiting");
    expect(existsSync(result.specPath)).toBe(true);
    expect(result.specPath).toContain(".phase2s/specs/");
  });

  it("2. retries on first invalid spec and succeeds on second valid spec", async () => {
    const provider = retryProvider();

    const result = await conductorGenSpec("add rate limiting", MOCK_CONFIG, {
      cwd: tmpDir,
      _provider: provider,
    });

    expect(provider.chatStream).toHaveBeenCalledTimes(2);
    expect(result.specPath).not.toBe("");
    expect(existsSync(result.specPath)).toBe(true);
  });

  it("3. returns empty specPath when provider throws", async () => {
    const result = await conductorGenSpec("add rate limiting", MOCK_CONFIG, {
      cwd: tmpDir,
      _provider: errorProvider(),
    });

    expect(result.specPath).toBe("");
    expect(result.specContent).toBe("");
  });

  it("4 (D4). returns empty specPath when both retry calls produce invalid specs", async () => {
    const provider = alwaysInvalidProvider();

    const result = await conductorGenSpec("add rate limiting", MOCK_CONFIG, {
      cwd: tmpDir,
      _provider: provider,
    });

    expect(provider.chatStream).toHaveBeenCalledTimes(2);
    expect(result.specPath).toBe("");
  });

  it("5 (D5). returns empty specPath when AbortController fires (simulated timeout)", async () => {
    vi.useFakeTimers();

    let result: Awaited<ReturnType<typeof conductorGenSpec>>;
    try {
      const promise = conductorGenSpec("add rate limiting", MOCK_CONFIG, {
        cwd: tmpDir,
        _provider: hangingProvider(),
        // Inject a synchronously-resolving context builder so buildConductorContext
        // completes before advanceTimersByTimeAsync runs (avoids macrotask/fake-timer race
        // introduced by the async exec refactor — real subprocess I/O fires after fake
        // timers have already advanced, leaving streamSpec's abort timer stranded).
        _buildContext: async () => "Branch: main\nRecent commits:\nabc123 feat: init",
      });

      // Advance past the 5-minute STREAM_TIMEOUT_MS; async variant lets microtasks
      // (the abort event propagation and Promise rejection) settle between ticks.
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 500);
      result = await promise;
    } finally {
      vi.useRealTimers();
    }

    expect(result!.specPath).toBe("");
  }, 15_000); // extend timeout: fake timers + async settling can take a moment
});

// ---------------------------------------------------------------------------
// runConduct tests
// ---------------------------------------------------------------------------

describe("runConduct()", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "conduct-cmd-test-"));
    // Pre-create a fake spec file for tests that mock conductorGenSpec
    mkdirSync(join(tmpDir, ".phase2s", "specs"), { recursive: true });
    writeFileSync(join(tmpDir, ".phase2s", "specs", "fake.md"), VALID_SPEC, "utf8");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("6. dry-run generates spec and prints DAG without calling runGoal", async () => {
    const { runGoal } = await import("../../src/cli/goal.js");
    vi.mocked(runGoal).mockClear();

    // Inject a mock conductorGenSpec result via spying on the module
    const conductorModule = await import("../../src/cli/conductor-prompt.js");
    vi.spyOn(conductorModule, "conductorGenSpec").mockResolvedValueOnce({
      specPath: join(tmpDir, ".phase2s", "specs", "fake.md"),
      specContent: VALID_SPEC,
    });

    const { runConduct } = await import("../../src/cli/conduct.js");
    await runConduct("add rate limiting", { dryRun: true, yes: true }, tmpDir);

    expect(runGoal).not.toHaveBeenCalled();
  });

  it("7. non-TTY mode skips confirmation and calls runGoal", async () => {
    const { runGoal } = await import("../../src/cli/goal.js");
    vi.mocked(runGoal).mockClear();

    const conductorModule = await import("../../src/cli/conductor-prompt.js");
    const fakeSpecPath = join(tmpDir, ".phase2s", "specs", "fake.md");
    vi.spyOn(conductorModule, "conductorGenSpec").mockResolvedValueOnce({
      specPath: fakeSpecPath,
      specContent: VALID_SPEC,
    });

    const { runConduct } = await import("../../src/cli/conduct.js");

    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    await runConduct("add rate limiting", {}, tmpDir);
    Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, configurable: true });

    expect(runGoal).toHaveBeenCalledWith(
      fakeSpecPath,
      expect.objectContaining({ orchestrator: true, cwd: tmpDir }),
    );
  });

  it("8 (D6). TTY + --yes skips confirmation and calls runGoal", async () => {
    const { runGoal } = await import("../../src/cli/goal.js");
    vi.mocked(runGoal).mockClear();

    const conductorModule = await import("../../src/cli/conductor-prompt.js");
    const fakeSpecPath = join(tmpDir, ".phase2s", "specs", "fake.md");
    vi.spyOn(conductorModule, "conductorGenSpec").mockResolvedValueOnce({
      specPath: fakeSpecPath,
      specContent: VALID_SPEC,
    });

    const { runConduct } = await import("../../src/cli/conduct.js");

    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    await runConduct("add rate limiting", { yes: true }, tmpDir);
    Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, configurable: true });

    // --yes flag should bypass confirmation and call runGoal
    expect(runGoal).toHaveBeenCalledWith(
      fakeSpecPath,
      expect.objectContaining({ orchestrator: true, cwd: tmpDir }),
    );
  });

  it("10. empty specPath → logs error and sets exitCode=1 without calling runGoal", async () => {
    const { runGoal } = await import("../../src/cli/goal.js");
    vi.mocked(runGoal).mockClear();

    const conductorModule = await import("../../src/cli/conductor-prompt.js");
    vi.spyOn(conductorModule, "conductorGenSpec").mockResolvedValueOnce({
      specPath: "",
      specContent: "",
    });

    const { runConduct } = await import("../../src/cli/conduct.js");
    const originalExitCode = process.exitCode;
    process.exitCode = undefined;

    await runConduct("fail this goal", { yes: true }, tmpDir);

    expect(runGoal).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);

    process.exitCode = originalExitCode;
  });
});

// ---------------------------------------------------------------------------
// CONDUCT_TOOL MCP dispatch
// ---------------------------------------------------------------------------

describe("CONDUCT_TOOL MCP dispatch (handleRequest)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "conduct-mcp-test-"));
    mkdirSync(join(tmpDir, ".phase2s", "specs"), { recursive: true });
    writeFileSync(join(tmpDir, ".phase2s", "specs", "fake.md"), VALID_SPEC, "utf8");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("9. routes phase2s__conduct to conductorGenSpec + runGoal and returns result text", async () => {
    const conductorModule = await import("../../src/cli/conductor-prompt.js");
    vi.spyOn(conductorModule, "conductorGenSpec").mockResolvedValue({
      specPath: join(tmpDir, ".phase2s", "specs", "fake.md"),
      specContent: VALID_SPEC,
    });

    const { handleRequest } = await import("../../src/mcp/handler.js");

    const response = await handleRequest(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "phase2s__conduct",
          arguments: { goal: "add rate limiting to the API" },
        },
      },
      [],
      tmpDir,
    );

    expect(response.error).toBeUndefined();
    expect(response.result).toBeDefined();
    const content = (response.result as { content: Array<{ type: string; text: string }> }).content;
    expect(content[0].text).toContain("Conductor run:");
    expect(content[0].text).toContain("add rate limiting to the API");
  });

  it("11. missing goal returns -32602 error", async () => {
    const { handleRequest } = await import("../../src/mcp/handler.js");

    const response = await handleRequest(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "phase2s__conduct",
          arguments: {},
        },
      },
      [],
      tmpDir,
    );

    expect(response.error).toBeDefined();
    expect(response.error?.code).toBe(-32602);
    expect(response.error?.message).toContain("goal is required");
  });

  it("12. spec generation failure returns -32603 error", async () => {
    const conductorModule = await import("../../src/cli/conductor-prompt.js");
    vi.spyOn(conductorModule, "conductorGenSpec").mockResolvedValueOnce({
      specPath: "",
      specContent: "",
    });

    const { handleRequest } = await import("../../src/mcp/handler.js");

    const response = await handleRequest(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "phase2s__conduct",
          arguments: { goal: "do something that fails" },
        },
      },
      [],
      tmpDir,
    );

    expect(response.error).toBeDefined();
    expect(response.error?.code).toBe(-32603);
    expect(response.error?.message).toContain("spec generation failed");
  });

  it("13. dryRun=true returns spec preview without calling runGoal", async () => {
    const { runGoal } = await import("../../src/cli/goal.js");
    vi.mocked(runGoal).mockClear();

    const conductorModule = await import("../../src/cli/conductor-prompt.js");
    vi.spyOn(conductorModule, "conductorGenSpec").mockResolvedValueOnce({
      specPath: join(tmpDir, ".phase2s", "specs", "fake.md"),
      specContent: VALID_SPEC,
    });

    const { handleRequest } = await import("../../src/mcp/handler.js");

    const response = await handleRequest(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "phase2s__conduct",
          arguments: { goal: "add rate limiting", dryRun: true },
        },
      },
      [],
      tmpDir,
    );

    expect(response.error).toBeUndefined();
    expect(runGoal).not.toHaveBeenCalled();
    const content = (response.result as { content: Array<{ type: string; text: string }> }).content;
    expect(content[0].text).toContain("dry-run");
  });
});

// ---------------------------------------------------------------------------
// buildConductorContext tests (async exec refactor)
// Uses vi.importActual to bypass the module-level mock and test the real impl.
// ---------------------------------------------------------------------------

describe("buildConductorContext() real implementation", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "conduct-ctx-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("14. non-git directory returns 'unknown' branch with no-commits placeholder", async () => {
    // vi.importActual bypasses the module-level mock to get the real function
    const { buildConductorContext: realBuildCtx } = await vi.importActual<
      typeof import("../../src/cli/conductor-prompt.js")
    >("../../src/cli/conductor-prompt.js");

    // tmpDir is not a git repo — all three exec calls fail gracefully
    const ctx = await realBuildCtx(tmpDir);

    expect(ctx).toContain("Branch: unknown");
    expect(ctx).toContain("Recent commits:");
    expect(ctx).toContain("(no commits)");
    expect(ctx).toContain("Changed files:");
  });

  it("15. non-git output is well under 2000 bytes and not truncated", async () => {
    const { buildConductorContext: realBuildCtx } = await vi.importActual<
      typeof import("../../src/cli/conductor-prompt.js")
    >("../../src/cli/conductor-prompt.js");

    const ctx = await realBuildCtx(tmpDir);

    // Non-git output is short — should not hit the 2000-byte cap
    expect(ctx).not.toContain("... (truncated)");
    expect(ctx.length).toBeLessThan(2000);
  });
});

// ---------------------------------------------------------------------------
// runConduct additional coverage
// ---------------------------------------------------------------------------

describe("runConduct() additional coverage", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "conduct-extra-test-"));
    mkdirSync(join(tmpDir, ".phase2s", "specs"), { recursive: true });
    writeFileSync(join(tmpDir, ".phase2s", "specs", "fake.md"), VALID_SPEC, "utf8");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("16. --output writes JSON summary file when runGoal succeeds", async () => {
    const { runGoal } = await import("../../src/cli/goal.js");
    vi.mocked(runGoal).mockClear();

    const conductorModule = await import("../../src/cli/conductor-prompt.js");
    const fakeSpecPath = join(tmpDir, ".phase2s", "specs", "fake.md");
    vi.spyOn(conductorModule, "conductorGenSpec").mockResolvedValueOnce({
      specPath: fakeSpecPath,
      specContent: VALID_SPEC,
    });

    const outputPath = join(tmpDir, "summary.json");
    const { runConduct } = await import("../../src/cli/conduct.js");

    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    await runConduct("add rate limiting", { yes: true, output: outputPath }, tmpDir);
    Object.defineProperty(process.stdin, "isTTY", { value: undefined, configurable: true });

    // The JSON output file should exist and contain valid JSON
    expect(existsSync(outputPath)).toBe(true);
    const written = JSON.parse(readFileSync(outputPath, "utf8"));
    expect(written.success).toBe(true);
    expect(written.attempts).toBe(1);
  });

  it("17. TTY + 'n' answer declines run and does not call runGoal", async () => {
    const { runGoal } = await import("../../src/cli/goal.js");
    vi.mocked(runGoal).mockClear();

    const conductorModule = await import("../../src/cli/conductor-prompt.js");
    const fakeSpecPath = join(tmpDir, ".phase2s", "specs", "fake.md");
    vi.spyOn(conductorModule, "conductorGenSpec").mockResolvedValueOnce({
      specPath: fakeSpecPath,
      specContent: VALID_SPEC,
    });

    // Use the module-level readline mock configured to return 'n'
    mockReadlineAnswer.value = "n";

    const { runConduct } = await import("../../src/cli/conduct.js");
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });

    await runConduct("add rate limiting", {}, tmpDir);

    Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, configurable: true });
    mockReadlineAnswer.value = "y"; // reset for other tests

    expect(runGoal).not.toHaveBeenCalled();
  });
});
