/**
 * Tests for src/goal/replan.ts
 *
 * Coverage:
 * - Happy path: agent returns valid JSON with valid sub-task names
 * - Markdown fence stripping: ```json wrapped response parsed correctly
 * - Empty revised array: replanFailingSubtasks returns []
 * - Malformed JSON: returns [] (degraded, not broken)
 * - Hallucinated sub-task name: entry dropped with dim warning
 * - Agent error/throw: returns []
 * - Missing "revised" key: returns []
 * - Mixed valid + invalid entries: only valid entries returned
 * - Eval output tail slicing: only the tail 4096 chars are sent to the agent
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Config } from "../../src/core/config.js";
import type { SubTask } from "../../src/core/spec-parser.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Capture the last Agent constructor opts and run() calls
let agentRunResult: string = "{}";
let agentRunThrows: Error | null = null;
let lastAgentPrompt: string = "";
let lastAgentOpts: unknown = null;
let lastAgentRunOpts: unknown = null;

vi.mock("../../src/core/agent.js", () => {
  class MockAgent {
    constructor(opts: unknown) {
      lastAgentOpts = opts;
    }
    async run(prompt: string, runOpts?: unknown): Promise<string> {
      lastAgentPrompt = prompt;
      lastAgentRunOpts = runOpts;
      if (agentRunThrows) throw agentRunThrows;
      return agentRunResult;
    }
  }
  return { Agent: MockAgent };
});

vi.mock("../../src/tools/registry.js", () => {
  class ToolRegistry {}
  return { ToolRegistry };
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeConfig(): Config {
  return {
    provider: "codex-cli",
    model: "gpt-4o",
    apiKey: "sk-test",
    anthropicApiKey: "sk-ant",
    anthropicMaxTokens: 8192,
    ollamaBaseUrl: undefined,
    fast_model: undefined,
    smart_model: undefined,
    codexPath: "codex",
    systemPrompt: undefined,
    maxTurns: 1,
    timeout: 30_000,
    allowDestructive: false,
    verifyCommand: "npm test",
    requireSpecification: false,
    tools: undefined,
    deny: undefined,
  } as Config;
}

function makeSubtasks(): SubTask[] {
  return [
    {
      name: "auth-flow",
      input: "src/auth/",
      output: "Working auth endpoints",
      successCriteria: "Login and logout return 200",
      files: ["src/auth/login.ts", "src/auth/logout.ts"],
    },
    {
      name: "card-selection",
      input: "src/cards/",
      output: "Card state management",
      successCriteria: "Selected cards persist across page refresh",
      files: ["src/cards/store.ts"],
    },
    {
      name: "history-schema",
      input: "src/db/",
      output: "History table migration",
      successCriteria: "Migration runs without error",
      files: ["src/db/migrations/001_history.sql"],
    },
  ];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("replanFailingSubtasks", () => {
  beforeEach(() => {
    agentRunResult = "{}";
    agentRunThrows = null;
    lastAgentPrompt = "";
    lastAgentOpts = null;
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  it("happy path: returns revised subtasks for valid sub-task names", async () => {
    const { replanFailingSubtasks } = await import("../../src/goal/replan.js");
    agentRunResult = JSON.stringify({
      revised: [
        { name: "auth-flow", description: "Fix the JWT validation — token was not being verified" },
        { name: "history-schema", description: "Add missing NOT NULL constraint to user_id column" },
      ],
    });

    const result = await replanFailingSubtasks(
      ["Auth flow must return 200", "History schema must migrate without error"],
      "Error: JWT invalid\nError: column null violation",
      makeSubtasks(),
      makeConfig(),
    );

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("auth-flow");
    expect(result[0].description).toContain("JWT");
    expect(result[1].name).toBe("history-schema");
  });

  it("strips ```json markdown fences before JSON.parse", async () => {
    const { replanFailingSubtasks } = await import("../../src/goal/replan.js");
    agentRunResult = '```json\n{"revised":[{"name":"auth-flow","description":"Fix token expiry check"}]}\n```';

    const result = await replanFailingSubtasks(
      ["Auth flow must return 200"],
      "Error: token expired",
      makeSubtasks(),
      makeConfig(),
    );

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("auth-flow");
    expect(result[0].description).toContain("expiry");
  });

  it("strips plain ``` fences (no language tag) before JSON.parse", async () => {
    const { replanFailingSubtasks } = await import("../../src/goal/replan.js");
    agentRunResult = '```\n{"revised":[{"name":"card-selection","description":"Persist state to localStorage"}]}\n```';

    const result = await replanFailingSubtasks(
      ["Card state must persist"],
      "Error: state lost on refresh",
      makeSubtasks(),
      makeConfig(),
    );

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("card-selection");
  });

  it("malformed JSON → returns [] (degraded, not broken)", async () => {
    const { replanFailingSubtasks } = await import("../../src/goal/replan.js");
    agentRunResult = "This is not JSON at all { broken }";

    const result = await replanFailingSubtasks(
      ["Auth flow must return 200"],
      "some eval output",
      makeSubtasks(),
      makeConfig(),
    );

    expect(result).toEqual([]);
  });

  it("empty revised array → returns []", async () => {
    const { replanFailingSubtasks } = await import("../../src/goal/replan.js");
    agentRunResult = JSON.stringify({ revised: [] });

    const result = await replanFailingSubtasks(
      ["Auth flow must return 200"],
      "some eval output",
      makeSubtasks(),
      makeConfig(),
    );

    expect(result).toEqual([]);
  });

  it("missing 'revised' key → returns []", async () => {
    const { replanFailingSubtasks } = await import("../../src/goal/replan.js");
    agentRunResult = JSON.stringify({ suggestions: [{ name: "auth-flow", description: "fix it" }] });

    const result = await replanFailingSubtasks(
      ["Auth flow must return 200"],
      "some eval output",
      makeSubtasks(),
      makeConfig(),
    );

    expect(result).toEqual([]);
  });

  it("hallucinated sub-task name → dropped with dim warning, valid names kept", async () => {
    const { replanFailingSubtasks } = await import("../../src/goal/replan.js");
    agentRunResult = JSON.stringify({
      revised: [
        { name: "auth-flow", description: "Fix the real thing" },
        { name: "nonexistent-subtask", description: "This subtask does not exist" },
        { name: "another-hallucination", description: "Also made up" },
      ],
    });

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const result = await replanFailingSubtasks(
      ["Auth flow must return 200"],
      "some eval output",
      makeSubtasks(),
      makeConfig(),
    );

    // Only the valid entry survives
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("auth-flow");

    // Hallucinated names logged to stderr
    const stderrOutput = stderrSpy.mock.calls.map((args) => String(args[0])).join("");
    expect(stderrOutput).toContain("nonexistent-subtask");
    expect(stderrOutput).toContain("another-hallucination");
  });

  it("agent.run() throws → returns []", async () => {
    const { replanFailingSubtasks } = await import("../../src/goal/replan.js");
    agentRunThrows = new Error("provider rate limited");

    const result = await replanFailingSubtasks(
      ["Auth flow must return 200"],
      "some eval output",
      makeSubtasks(),
      makeConfig(),
    );

    expect(result).toEqual([]);
  });

  it("mixed valid and malformed entries in revised array: only valid entries returned", async () => {
    const { replanFailingSubtasks } = await import("../../src/goal/replan.js");
    agentRunResult = JSON.stringify({
      revised: [
        { name: "auth-flow", description: "Fix auth" },
        { notName: "oops", description: "malformed entry" },
        42,
        null,
        { name: "card-selection", description: "Fix card state" },
      ],
    });

    const result = await replanFailingSubtasks(
      ["Auth flow must return 200", "Card state must persist"],
      "eval output",
      makeSubtasks(),
      makeConfig(),
    );

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.name)).toEqual(["auth-flow", "card-selection"]);
  });

  it("emits progress message to stderr before calling agent", async () => {
    const { replanFailingSubtasks } = await import("../../src/goal/replan.js");
    agentRunResult = JSON.stringify({ revised: [] });

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await replanFailingSubtasks(["criterion"], "output", makeSubtasks(), makeConfig());

    const stderrOutput = stderrSpy.mock.calls.map((args) => String(args[0])).join("");
    expect(stderrOutput).toContain("Analyzing failures");
  });

  it("sends the TAIL of long eval output to the agent (not the head)", async () => {
    const { replanFailingSubtasks } = await import("../../src/goal/replan.js");
    agentRunResult = JSON.stringify({ revised: [] });

    // Build an output where the unique head marker appears only at position 0-24,
    // followed by padding, then a unique tail marker.
    // Total length must exceed EVAL_OUTPUT_MAX (4096) so truncation fires.
    const uniqueHeadMarker = "UNIQUE_HEAD_ONLY_MARKER";       // 23 chars, only at position 0
    const padding = "x".repeat(5000);                          // 5000 chars of filler
    const uniqueTailMarker = "UNIQUE_TAIL_FAILURE_MARKER";    // only at the very end
    const longEvalOutput = uniqueHeadMarker + padding + uniqueTailMarker;
    // Total: ~5049 chars. Tail slice of 4096 starts at char 953 — past the head marker.

    await replanFailingSubtasks(["criterion fails"], longEvalOutput, makeSubtasks(), makeConfig());

    // Tail marker must appear in the prompt (it's within the last 4096 chars)
    expect(lastAgentPrompt).toContain(uniqueTailMarker);
    // Head marker must NOT appear in the prompt (it was sliced off)
    expect(lastAgentPrompt).not.toContain(uniqueHeadMarker);
  });

  it("agent is constructed with an empty tool registry (no file-system access)", async () => {
    const { replanFailingSubtasks } = await import("../../src/goal/replan.js");
    agentRunResult = JSON.stringify({ revised: [] });

    await replanFailingSubtasks(["criterion"], "output", makeSubtasks(), makeConfig());

    // tools should be a ToolRegistry instance (the mocked one), not undefined
    const opts = lastAgentOpts as Record<string, unknown>;
    expect(opts.tools).toBeDefined();
    // ToolRegistry is mocked as an empty class — just verifying it was passed
    expect(typeof opts.tools).toBe("object");
  });

  it("passes modelOverride to agent.run when provided (Sprint 66)", async () => {
    const { replanFailingSubtasks } = await import("../../src/goal/replan.js");
    agentRunResult = JSON.stringify({ revised: [] });

    await replanFailingSubtasks(
      ["criterion"],
      "output",
      makeSubtasks(),
      makeConfig(),
      "claude-opus-4-5",
    );

    const runOpts = lastAgentRunOpts as { modelOverride?: string } | undefined;
    expect(runOpts?.modelOverride).toBe("claude-opus-4-5");
  });

  it("passes undefined modelOverride when not provided", async () => {
    const { replanFailingSubtasks } = await import("../../src/goal/replan.js");
    agentRunResult = JSON.stringify({ revised: [] });

    await replanFailingSubtasks(["criterion"], "output", makeSubtasks(), makeConfig());

    const runOpts = lastAgentRunOpts as { modelOverride?: string } | undefined;
    expect(runOpts?.modelOverride).toBeUndefined();
  });
});
