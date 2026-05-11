/**
 * Tests for the conductor: conductorGenSpec() + runConduct().
 *
 * Coverage — Sprint 86 (tests 1-17):
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
 *
 * Sprint 87 hardening (tests 18-29):
 * 18. conductorGenSpec (A/D4) — goal > GOAL_MAX_CHARS → truncated + console.warn
 * 19. conductorGenSpec (A/D4) — goal ≤ GOAL_MAX_CHARS → passed through unchanged
 * 20. runConduct (B) — unrecognized model with strict provider → chalk.yellow warn
 * 21. runConduct (B) — recognized model prefix (gpt-4o) → no warn
 * 22. runConduct (B) — ollama provider → skip validation, no warn
 * 23. runConduct (B) — colon-format model (gemma4:latest) → no warn (Ollama tag fix)
 * 24. conductorGenSpec (C) — _randomSuffix injected → specPath ends with injected suffix
 * 25. conductorGenSpec (C) — _randomSuffix throws → fallback to randomBytes hex (valid path)
 * 26. conductorGenSpec (D5) — model='fast' resolves to config.fast_model before LLM call
 * 27. conductorGenSpec (D5) — model='smart' resolves to config.smart_model before LLM call
 * 28. runConduct (B) — tier alias 'fast' → no warn (adversarial review fix)
 * 29. runConduct (B) — tier alias 'smart' → no warn (adversarial review fix)
 *
 * Post-review hardening (tests 30-32):
 * 30. conductorGenSpec (D5) — uppercase 'FAST' resolves case-insensitively to fast_model
 * 31. conductorGenSpec (B) — model='fast' with no fast_model in config → unresolved alias warn
 * 32. conductorGenSpec (A/D4) — goal exactly GOAL_MAX_CHARS+1 → truncation fires at boundary
 *
 * Sprint 88 flag parity (tests 33-35):
 * 33. runConduct — --review-before-run passed through to runGoal
 * 34. runConduct — --dashboard passed through to runGoal
 * 35. runConduct — --resume passed through to runGoal
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { conductorGenSpec, GOAL_MAX_CHARS } from "../../src/cli/conductor-prompt.js";

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

// Mock renderConductSummary so existing runConduct tests aren't polluted with summary output
vi.mock("../../src/cli/conduct-summary.js", () => ({
  renderConductSummary: vi.fn(),
}));

// Mock appendConductLog so runConduct tests don't write to the filesystem (Sprint 90).
// Individual tests that want to verify log behavior can vi.spyOn this mock.
vi.mock("../../src/cli/conduct-log.js", () => ({
  appendConductLog: vi.fn().mockResolvedValue(undefined),
  readConductLog: vi.fn().mockResolvedValue([]),
  renderConductLog: vi.fn(),
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

  it("33 (Sprint 88). --review-before-run is passed through to runGoal options", async () => {
    const { runGoal } = await import("../../src/cli/goal.js");
    vi.mocked(runGoal).mockClear();

    const conductorModule = await import("../../src/cli/conductor-prompt.js");
    const fakeSpecPath = join(tmpDir, ".phase2s", "specs", "fake.md");
    vi.spyOn(conductorModule, "conductorGenSpec").mockResolvedValueOnce({
      specPath: fakeSpecPath,
      specContent: VALID_SPEC,
    });

    const { runConduct } = await import("../../src/cli/conduct.js");
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    await runConduct("add rate limiting", { reviewBeforeRun: true }, tmpDir);
    Object.defineProperty(process.stdin, "isTTY", { value: undefined, configurable: true });

    expect(runGoal).toHaveBeenCalledWith(
      fakeSpecPath,
      expect.objectContaining({ reviewBeforeRun: true }),
    );
  });

  it("34 (Sprint 88). --dashboard is passed through to runGoal options", async () => {
    const { runGoal } = await import("../../src/cli/goal.js");
    vi.mocked(runGoal).mockClear();

    const conductorModule = await import("../../src/cli/conductor-prompt.js");
    const fakeSpecPath = join(tmpDir, ".phase2s", "specs", "fake.md");
    vi.spyOn(conductorModule, "conductorGenSpec").mockResolvedValueOnce({
      specPath: fakeSpecPath,
      specContent: VALID_SPEC,
    });

    const { runConduct } = await import("../../src/cli/conduct.js");
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    await runConduct("add rate limiting", { dashboard: true }, tmpDir);
    Object.defineProperty(process.stdin, "isTTY", { value: undefined, configurable: true });

    expect(runGoal).toHaveBeenCalledWith(
      fakeSpecPath,
      expect.objectContaining({ dashboard: true }),
    );
  });

  it("35 (Sprint 88). --resume is passed through to runGoal options", async () => {
    const { runGoal } = await import("../../src/cli/goal.js");
    vi.mocked(runGoal).mockClear();

    const conductorModule = await import("../../src/cli/conductor-prompt.js");
    const fakeSpecPath = join(tmpDir, ".phase2s", "specs", "fake.md");
    vi.spyOn(conductorModule, "conductorGenSpec").mockResolvedValueOnce({
      specPath: fakeSpecPath,
      specContent: VALID_SPEC,
    });

    const { runConduct } = await import("../../src/cli/conduct.js");
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    await runConduct("add rate limiting", { resume: true }, tmpDir);
    Object.defineProperty(process.stdin, "isTTY", { value: undefined, configurable: true });

    expect(runGoal).toHaveBeenCalledWith(
      fakeSpecPath,
      expect.objectContaining({ resume: true }),
    );
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

// ---------------------------------------------------------------------------
// Sprint 87: Goal length cap, model validation, filename uniqueness (tests 18-24)
// ---------------------------------------------------------------------------

describe("conductorGenSpec() — Sprint 87 hardening", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "conduct-s87-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // ---- 18: Goal truncation ----

  it("18 (A/D4). goal longer than GOAL_MAX_CHARS is truncated and console.warn is called", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const oversizedGoal = "x".repeat(GOAL_MAX_CHARS + 500);

    // Capture what conductorGenSpec actually receives as the goal via the prompt
    let capturedPrompt = "";
    const provider = {
      name: "mock",
      chatStream: vi.fn().mockImplementation(async function* (messages: Array<{ content: string }>) {
        capturedPrompt = messages[0]?.content ?? "";
        yield { type: "text" as const, content: VALID_SPEC };
        yield { type: "done" as const, stopReason: "end_turn" };
      }),
    };

    await conductorGenSpec(oversizedGoal, MOCK_CONFIG, {
      cwd: tmpDir,
      _provider: provider,
      _buildContext: async () => "Branch: main",
    });

    // Warning was emitted
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(`${GOAL_MAX_CHARS} characters`));
    // The prompt does NOT contain a run of x's longer than GOAL_MAX_CHARS (goal was truncated)
    expect(capturedPrompt).not.toContain("x".repeat(GOAL_MAX_CHARS + 1));
    // The prompt DOES contain exactly GOAL_MAX_CHARS x's (the truncated goal)
    expect(capturedPrompt).toContain("x".repeat(GOAL_MAX_CHARS));
  });

  // ---- 19: No truncation ----

  it("19 (A/D4). goal at exactly GOAL_MAX_CHARS is passed through without warning", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const exactGoal = "y".repeat(GOAL_MAX_CHARS);

    let capturedPrompt = "";
    const provider = {
      name: "mock",
      chatStream: vi.fn().mockImplementation(async function* (messages: Array<{ content: string }>) {
        capturedPrompt = messages[0]?.content ?? "";
        yield { type: "text" as const, content: VALID_SPEC };
        yield { type: "done" as const, stopReason: "end_turn" };
      }),
    };

    await conductorGenSpec(exactGoal, MOCK_CONFIG, {
      cwd: tmpDir,
      _provider: provider,
      _buildContext: async () => "Branch: main",
    });

    expect(warnSpy).not.toHaveBeenCalled();
    // The exact goal appears in the prompt unchanged
    expect(capturedPrompt).toContain(exactGoal);
  });

  // ---- 24: Deterministic filename via _randomSuffix ----

  it("24 (C). _randomSuffix injection produces a deterministic specPath", async () => {
    const provider = {
      name: "mock",
      chatStream: vi.fn().mockImplementation(async function* () {
        yield { type: "text" as const, content: VALID_SPEC };
        yield { type: "done" as const, stopReason: "end_turn" };
      }),
    };

    const result = await conductorGenSpec("add rate limiting", MOCK_CONFIG, {
      cwd: tmpDir,
      _provider: provider,
      _buildContext: async () => "Branch: main",
      _randomSuffix: () => "deadbeef",
    });

    expect(result.specPath).not.toBe("");
    expect(result.specPath).toMatch(/-deadbeef\.md$/);
  });

  // ---- 25: _randomSuffix throw fallback ----

  it("25 (C). _randomSuffix that throws falls back to randomBytes hex — specPath still valid", async () => {
    const provider = {
      name: "mock",
      chatStream: vi.fn().mockImplementation(async function* () {
        yield { type: "text" as const, content: VALID_SPEC };
        yield { type: "done" as const, stopReason: "end_turn" };
      }),
    };

    const result = await conductorGenSpec("add rate limiting", MOCK_CONFIG, {
      cwd: tmpDir,
      _provider: provider,
      _buildContext: async () => "Branch: main",
      // This fn throws — conductorGenSpec should fall back to randomBytes(4).toString("hex")
      _randomSuffix: () => { throw new Error("entropy source unavailable"); },
    });

    // Should still succeed (fallback kicks in)
    expect(result.specPath).not.toBe("");
    // The fallback (randomBytes(4)) always produces a fixed 8-char hex suffix
    expect(result.specPath).toMatch(/-[0-9a-f]{8}\.md$/);
  });

  // ---- 26-27: Tier alias resolution (D5) ----

  it("26 (D5). model='fast' resolves to config.fast_model before the LLM call", async () => {
    let capturedModel = "";
    const provider = {
      name: "mock",
      chatStream: vi.fn().mockImplementation(async function* (
        _messages: unknown,
        _tools: unknown,
        opts: { model: string },
      ) {
        capturedModel = opts.model;
        yield { type: "text" as const, content: VALID_SPEC };
        yield { type: "done" as const, stopReason: "end_turn" };
      }),
    };

    const configWithFastModel = {
      ...MOCK_CONFIG,
      fast_model: "gpt-4o-mini",
      smart_model: "gpt-4o",
    };

    await conductorGenSpec("add rate limiting", configWithFastModel, {
      cwd: tmpDir,
      model: "fast",
      _provider: provider,
      _buildContext: async () => "Branch: main",
    });

    // "fast" should resolve to fast_model, not be passed literally
    expect(capturedModel).toBe("gpt-4o-mini");
    expect(capturedModel).not.toBe("fast");
  });

  it("27 (D5). model='smart' resolves to config.smart_model before the LLM call", async () => {
    let capturedModel = "";
    const provider = {
      name: "mock",
      chatStream: vi.fn().mockImplementation(async function* (
        _messages: unknown,
        _tools: unknown,
        opts: { model: string },
      ) {
        capturedModel = opts.model;
        yield { type: "text" as const, content: VALID_SPEC };
        yield { type: "done" as const, stopReason: "end_turn" };
      }),
    };

    const configWithSmartModel = {
      ...MOCK_CONFIG,
      fast_model: "gpt-4o-mini",
      smart_model: "gpt-4o",
    };

    await conductorGenSpec("add rate limiting", configWithSmartModel, {
      cwd: tmpDir,
      model: "smart",
      _provider: provider,
      _buildContext: async () => "Branch: main",
    });

    // "smart" should resolve to smart_model, not be passed literally
    expect(capturedModel).toBe("gpt-4o");
    expect(capturedModel).not.toBe("smart");
  });
});

describe("runConduct() — Sprint 87 model validation (tests 20-23)", () => {
  let tmpDir: string;
  let originalIsTTY: boolean | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "conduct-model-"));
    originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
  });

  afterEach(async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, configurable: true });
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  afterAll(() => {
    vi.resetModules();
  });

  async function runWithModel(model: string, provider: string = "openai-api") {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Mock loadConfig to return the given provider
    const { loadConfig } = await import("../../src/core/config.js");
    vi.mocked(loadConfig).mockResolvedValueOnce({ ...MOCK_CONFIG, provider: provider as "openai-api" });

    const conductorModule = await import("../../src/cli/conductor-prompt.js");
    const fakeSpecPath = join(tmpDir, ".phase2s", "specs", "fake.md");
    vi.spyOn(conductorModule, "conductorGenSpec").mockResolvedValueOnce({
      specPath: fakeSpecPath,
      specContent: VALID_SPEC,
    });

    const { runConduct } = await import("../../src/cli/conduct.js");
    await runConduct("add feature", { model, dryRun: true, quiet: false }, tmpDir);

    // Combine log + warn output so assertions work regardless of which channel is used
    return [...logSpy.mock.calls.flat(), ...warnSpy.mock.calls.flat()].join("\n");
  }

  it("20 (B). unrecognized model with strict provider emits a yellow warning", async () => {
    const output = await runWithModel("banana-turbo-3.5", "openai-api");
    expect(output).toContain("Unrecognized model");
    expect(output).toContain("banana-turbo-3.5");
  });

  it("21 (B). recognized model prefix (gpt-4o) does not warn", async () => {
    const output = await runWithModel("gpt-4o", "openai-api");
    expect(output).not.toContain("Unrecognized model");
  });

  it("22 (B). ollama provider skips validation — no warn even for unknown model string", async () => {
    const output = await runWithModel("totally-unknown-model-abc", "ollama");
    expect(output).not.toContain("Unrecognized model");
  });

  it("23 (B). colon-format model (gemma4:latest) does not warn regardless of provider", async () => {
    // This is the key adversarial-review fix: Ollama tag format should never warn
    const output = await runWithModel("gemma4:latest", "openai-api");
    expect(output).not.toContain("Unrecognized model");
  });

  it("28 (B). tier alias --model fast does not warn (resolved downstream in conductorGenSpec)", async () => {
    // Adversarial review finding #1: 'fast'/'smart' are valid aliases, not typos
    const output = await runWithModel("fast", "openai-api");
    expect(output).not.toContain("Unrecognized model");
  });

  it("29 (B). tier alias --model smart does not warn", async () => {
    const output = await runWithModel("smart", "openai-api");
    expect(output).not.toContain("Unrecognized model");
  });
});

// ---------------------------------------------------------------------------
// Tests 30-32: Post-review hardening — conductorGenSpec validation additions
// ---------------------------------------------------------------------------

describe("conductorGenSpec() — post-review hardening (tests 30-32)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "conduct-postrev-"));
  });

  afterEach(async () => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // Helper: build a minimal streaming provider that yields VALID_SPEC
  function makeProvider() {
    return {
      name: "mock",
      chatStream: vi.fn().mockImplementation(async function* (
        _messages: unknown,
        _tools: unknown,
        _opts: unknown,
      ) {
        yield { type: "text" as const, content: VALID_SPEC };
        yield { type: "done" as const, stopReason: "end_turn" };
      }),
    };
  }

  it("30 (D5). uppercase 'FAST' resolves case-insensitively to config.fast_model", async () => {
    let capturedModel = "";
    const provider = {
      name: "mock",
      chatStream: vi.fn().mockImplementation(async function* (
        _messages: unknown,
        _tools: unknown,
        opts: { model: string },
      ) {
        capturedModel = opts.model;
        yield { type: "text" as const, content: VALID_SPEC };
        yield { type: "done" as const, stopReason: "end_turn" };
      }),
    };

    const configWithFastModel = { ...MOCK_CONFIG, fast_model: "gpt-4o-mini" };
    await conductorGenSpec("build something", configWithFastModel, {
      cwd: tmpDir,
      model: "FAST", // uppercase alias — should resolve to fast_model
      _provider: provider,
      _buildContext: async () => "Branch: main",
    });

    // Case-insensitive alias resolution: "FAST".toLowerCase() === "fast" → fast_model
    expect(capturedModel).toBe("gpt-4o-mini");
    expect(capturedModel).not.toBe("FAST");
  });

  it("31 (B). model='fast' with no fast_model in config → unresolved alias console.warn", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // MOCK_CONFIG has no fast_model field — alias resolves to itself ("fast")
    await conductorGenSpec("build something", MOCK_CONFIG, {
      cwd: tmpDir,
      model: "fast",
      _provider: makeProvider(),
      _buildContext: async () => "Branch: main",
    });

    const warnOutput = warnSpy.mock.calls.flat().join("\n");
    // Should warn that the alias didn't resolve
    expect(warnOutput).toContain("fast_model");
    expect(warnOutput).toContain("did not resolve");
  });

  it("32 (A/D4). goal of exactly GOAL_MAX_CHARS+1 → truncation warn fires at boundary", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Boundary: GOAL_MAX_CHARS+1 should trigger truncation (strict > condition)
    const boundary = "x".repeat(GOAL_MAX_CHARS + 1);
    await conductorGenSpec(boundary, MOCK_CONFIG, {
      cwd: tmpDir,
      _provider: makeProvider(),
      _buildContext: async () => "Branch: main",
    });

    const warnOutput = warnSpy.mock.calls.flat().join("\n");
    expect(warnOutput).toContain("Goal truncated");
    expect(warnOutput).toContain(String(GOAL_MAX_CHARS + 1));
  });
});

// ---------------------------------------------------------------------------
// Sprint 90: conduct-log, --validate, refinement loop (tests 36-64)
// ---------------------------------------------------------------------------

describe("Sprint 90 — conduct-log, --validate, refinement loop", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "conduct-sprint90-"));
    mkdirSync(join(tmpDir, ".phase2s", "specs"), { recursive: true });
    mockReadlineAnswer.value = "y"; // default: run
  });

  afterEach(async () => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
    const originalIsTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    if (originalIsTTY) {
      Object.defineProperty(process.stdin, "isTTY", { value: undefined, configurable: true });
    }
  });

  // Helper: spy on conductorGenSpec and return VALID_SPEC
  async function mockGenSpec(fakeSpecPath: string) {
    const conductorModule = await import("../../src/cli/conductor-prompt.js");
    vi.spyOn(conductorModule, "conductorGenSpec").mockResolvedValue({
      specPath: fakeSpecPath,
      specContent: VALID_SPEC,
    });
    return conductorModule;
  }

  // -------------------------------------------------------------------------
  // conduct-log wiring (appendConductLog called in finally)
  // -------------------------------------------------------------------------

  it("51. appendConductLog is called after a successful conduct run", async () => {
    const { appendConductLog } = await import("../../src/cli/conduct-log.js");
    vi.mocked(appendConductLog).mockClear();

    const fakeSpecPath = join(tmpDir, ".phase2s", "specs", "fake.md");
    await mockGenSpec(fakeSpecPath);

    const { runConduct } = await import("../../src/cli/conduct.js");
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    await runConduct("add health endpoint", { yes: true }, tmpDir);

    expect(vi.mocked(appendConductLog)).toHaveBeenCalledOnce();
    const callArgs = vi.mocked(appendConductLog).mock.calls[0][0];
    expect(callArgs.goal).toBe("add health endpoint");
    expect(callArgs.rounds).toBe(0);
  });

  it("52. appendConductLog error in finally does not crash runConduct or change exit code", async () => {
    const { appendConductLog } = await import("../../src/cli/conduct-log.js");
    vi.mocked(appendConductLog).mockRejectedValueOnce(new Error("disk full"));

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const fakeSpecPath = join(tmpDir, ".phase2s", "specs", "fake.md");
    await mockGenSpec(fakeSpecPath);

    const { runConduct } = await import("../../src/cli/conduct.js");
    const savedExitCode = process.exitCode;
    process.exitCode = undefined;

    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    // Should NOT throw
    await expect(runConduct("add rate limiting", { yes: true }, tmpDir)).resolves.not.toThrow();

    // Should warn about the log failure
    const warnOutput = warnSpy.mock.calls.flat().join("\n");
    expect(warnOutput).toContain("conduct-log");
    expect(warnOutput).toContain("disk full");

    process.exitCode = savedExitCode;
  });

  it("53. conduct run with spec gen failure (specPath='') does NOT call appendConductLog; exits 1", async () => {
    const { appendConductLog } = await import("../../src/cli/conduct-log.js");
    vi.mocked(appendConductLog).mockClear();

    const conductorModule = await import("../../src/cli/conductor-prompt.js");
    vi.spyOn(conductorModule, "conductorGenSpec").mockResolvedValueOnce({
      specPath: "",
      specContent: "",
    });

    const { runConduct } = await import("../../src/cli/conduct.js");
    const savedExitCode = process.exitCode;
    process.exitCode = undefined;

    await runConduct("bad goal", { yes: true }, tmpDir);

    // currentSpecPath remains "" (falsy) so the finally-block guard skips logging.
    expect(vi.mocked(appendConductLog)).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    process.exitCode = savedExitCode;
  });

  // -------------------------------------------------------------------------
  // --validate flag
  // -------------------------------------------------------------------------

  it("54. --validate: 4/4 passes on a valid spec (3+ unique-role subtasks), does not block execution", async () => {
    // Use a 3-subtask spec so it passes CONDUCTOR_MIN_SUBTASKS (3) check
    const validSpec3 = `# Add rate limiting

## Problem Statement
Add per-user rate limiting to the API.

## Decomposition

### Sub-task 1: Architect rate limiting design
**Role:** architect
- **Files:** arch-plan.md
- **Input:** Goal description
- **Output:** arch-plan.md
- **Success criteria:** arch-plan.md exists

### Sub-task 2: Implement rate limiter
**Role:** implementer
- **Files:** src/middleware/rate-limiter.ts
- **Input:** arch-plan.md
- **Output:** rate-limiter.ts
- **Success criteria:** Tests pass

### Sub-task 3: Verify implementation
**Role:** tester
- **Files:** test/rate-limiter.test.ts
- **Input:** rate-limiter.ts
- **Output:** test results
- **Success criteria:** All tests pass

## Eval Command
npm test

## Acceptance Criteria
- Rate limiting implemented
- Tests pass
- Eval command exits 0
`;
    const fakeSpecPath = join(tmpDir, ".phase2s", "specs", "fake.md");
    const conductorModule = await import("../../src/cli/conductor-prompt.js");
    vi.spyOn(conductorModule, "conductorGenSpec").mockResolvedValueOnce({
      specPath: fakeSpecPath,
      specContent: validSpec3,
    });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { runConduct } = await import("../../src/cli/conduct.js");
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    await runConduct("add rate limiting", { yes: true, validate: true }, tmpDir);

    const { runGoal } = await import("../../src/cli/goal.js");
    expect(vi.mocked(runGoal)).toHaveBeenCalled();

    const output = logSpy.mock.calls.flat().join("\n");
    expect(output).toContain("4/4 checks passed");
  });

  it("55. --validate: non-TTY + failures → exitCode=1, runGoal not called", async () => {
    // Spec with only 1 subtask — fails min-subtasks check
    const oneSubtaskSpec = `# Minimal spec

## Problem Statement
Too small.

## Decomposition

### Sub-task 1: Do something
**Role:** implementer
- **Files:** src/foo.ts
- **Input:** goal
- **Output:** foo.ts
- **Success criteria:** foo.ts exists

## Eval Command
npm test

## Acceptance Criteria
- Done
`;
    const conductorModule = await import("../../src/cli/conductor-prompt.js");
    vi.spyOn(conductorModule, "conductorGenSpec").mockResolvedValueOnce({
      specPath: join(tmpDir, ".phase2s", "specs", "small.md"),
      specContent: oneSubtaskSpec,
    });

    const { runGoal } = await import("../../src/cli/goal.js");
    vi.mocked(runGoal).mockClear();

    const { runConduct } = await import("../../src/cli/conduct.js");
    const savedExitCode = process.exitCode;
    process.exitCode = undefined;

    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    await runConduct("add rate limiting", { validate: true }, tmpDir);

    expect(process.exitCode).toBe(1);
    expect(vi.mocked(runGoal)).not.toHaveBeenCalled();

    process.exitCode = savedExitCode;
  });

  // -------------------------------------------------------------------------
  // promptTriMode (Sprint 90, Part 4)
  // -------------------------------------------------------------------------

  it("56. promptTriMode: 'y' → 'run'", async () => {
    mockReadlineAnswer.value = "y";
    const { promptTriMode } = await import("../../src/cli/conduct.js");
    const result = await promptTriMode("▶ Run? ");
    expect(result).toBe("run");
  });

  it("57. promptTriMode: 'yes' → 'run'", async () => {
    mockReadlineAnswer.value = "yes";
    const { promptTriMode } = await import("../../src/cli/conduct.js");
    const result = await promptTriMode("▶ Run? ");
    expect(result).toBe("run");
  });

  it("58. promptTriMode: '' (empty) → 'exit'", async () => {
    mockReadlineAnswer.value = "";
    const { promptTriMode } = await import("../../src/cli/conduct.js");
    const result = await promptTriMode("▶ Run? ");
    expect(result).toBe("exit");
  });

  it("59. promptTriMode: 'n' → 'exit'", async () => {
    mockReadlineAnswer.value = "n";
    const { promptTriMode } = await import("../../src/cli/conduct.js");
    const result = await promptTriMode("▶ Run? ");
    expect(result).toBe("exit");
  });

  it("60. promptTriMode: 'no' → 'exit'", async () => {
    mockReadlineAnswer.value = "no";
    const { promptTriMode } = await import("../../src/cli/conduct.js");
    const result = await promptTriMode("▶ Run? ");
    expect(result).toBe("exit");
  });

  it("61. promptTriMode: arbitrary feedback text → returned as feedback string", async () => {
    mockReadlineAnswer.value = "Make the architect more specific";
    const { promptTriMode } = await import("../../src/cli/conduct.js");
    const result = await promptTriMode("▶ Run? ");
    expect(result).toBe("Make the architect more specific");
    expect(result).not.toBe("run");
    expect(result).not.toBe("exit");
  });

  // -------------------------------------------------------------------------
  // Refinement loop (Sprint 90, Part 4)
  // -------------------------------------------------------------------------

  it("62. refinement loop: feedback triggers re-call of conductorGenSpec with feedback option", async () => {
    const fakeSpecPath = join(tmpDir, ".phase2s", "specs", "fake.md");
    const conductorModule = await import("../../src/cli/conductor-prompt.js");
    const genSpy = vi.spyOn(conductorModule, "conductorGenSpec")
      .mockResolvedValueOnce({ specPath: fakeSpecPath, specContent: VALID_SPEC }) // initial
      .mockResolvedValueOnce({ specPath: fakeSpecPath + ".v2", specContent: VALID_SPEC }); // refined

    // First readline answer = feedback, second = 'y' (run)
    let callCount = 0;
    const { createInterface } = await import("node:readline");
    vi.mocked(createInterface).mockImplementation(() => ({
      question: vi.fn((_q: string, cb: (a: string) => void) => {
        callCount++;
        cb(callCount === 1 ? "Make architect more specific" : "y");
      }),
      close: vi.fn(),
    }) as ReturnType<typeof createInterface>);

    const { runConduct } = await import("../../src/cli/conduct.js");
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    await runConduct("add rate limiting", {}, tmpDir);

    // conductorGenSpec called twice: initial + one refinement round
    expect(genSpy).toHaveBeenCalledTimes(2);
    // Second call must carry feedback
    expect(genSpy.mock.calls[1][2]).toMatchObject({
      feedback: "Make architect more specific",
    });
  });

  it("63. refinement loop max 3 rounds enforced — 4th feedback falls back to binary prompt", async () => {
    const fakeSpecPath = join(tmpDir, ".phase2s", "specs", "fake.md");
    const conductorModule = await import("../../src/cli/conductor-prompt.js");
    // Each call returns valid spec
    vi.spyOn(conductorModule, "conductorGenSpec").mockResolvedValue({
      specPath: fakeSpecPath,
      specContent: VALID_SPEC,
    });

    // readline: 3 rounds of feedback, then 'y' to run
    let callCount = 0;
    const { createInterface } = await import("node:readline");
    vi.mocked(createInterface).mockImplementation(() => ({
      question: vi.fn((_q: string, cb: (a: string) => void) => {
        callCount++;
        if (callCount <= 3) {
          cb("more detail please");
        } else {
          cb("y"); // binary prompt at round 3
        }
      }),
      close: vi.fn(),
    }) as ReturnType<typeof createInterface>);

    const { runConduct } = await import("../../src/cli/conduct.js");
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    await runConduct("add rate limiting", {}, tmpDir);

    const { runGoal } = await import("../../src/cli/goal.js");
    // runGoal should have been called (rounds reached max, user confirmed)
    expect(vi.mocked(runGoal)).toHaveBeenCalled();
    // conductorGenSpec called 4 times: 1 initial + 3 refinements
    expect(vi.mocked(conductorModule.conductorGenSpec)).toHaveBeenCalledTimes(4);
  });

  // -------------------------------------------------------------------------
  // conductorGenSpec feedback option (Sprint 90)
  // -------------------------------------------------------------------------

  it("64. conductorGenSpec: feedback prepended to prompt when provided", async () => {
    const { mkdtempSync: mktmp } = await import("node:fs");
    const specDir = mktmp(join(tmpdir(), "spec-feedback-"));

    let capturedMessages: { role: string; content: string }[] = [];
    const provider = {
      name: "mock",
      chatStream: vi.fn().mockImplementation(async function* (msgs: typeof capturedMessages) {
        capturedMessages = msgs;
        yield { type: "text" as const, content: VALID_SPEC };
        yield { type: "done" as const, stopReason: "end_turn" };
      }),
    };

    await conductorGenSpec("add rate limiting", MOCK_CONFIG, {
      cwd: specDir,
      _provider: provider,
      _buildContext: async () => "Branch: main",
      feedback: "Make the architect subtask more specific",
      _prevSpecContent: "# Previous spec\n...",
    });

    rmSync(specDir, { recursive: true, force: true });

    expect(capturedMessages[0].content).toContain("Previous spec had issues: Make the architect subtask more specific");
    expect(capturedMessages[0].content).toContain("# Previous spec");
  });
});
