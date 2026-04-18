/**
 * Sprint 56: AGENTS.md injection in one-shot mode.
 *
 * Tests that oneShotMode() loads AGENTS.md via loadAgentsMd() and passes the
 * formatted block to the Agent constructor — matching the REPL path (line ~827).
 *
 * Mock strategy:
 * - agents-md.ts: vi.mock to control what loadAgentsMd returns
 * - agent.ts: vi.mock to capture constructor opts without spinning up a real LLM
 * - memory.ts: vi.mock to skip disk reads for learnings
 * - skills/index.ts: vi.mock to return empty skills list
 * - cli/index.ts internals (checkCodexBinary etc.) mocked via the module mocks below
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Config } from "../../src/core/config.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Capture last Agent constructor opts so tests can assert on agentsMdBlock.
let lastAgentOpts: Record<string, unknown> = {};

vi.mock("../../src/core/agent.js", () => {
  class MockAgent {
    constructor(opts: Record<string, unknown>) {
      lastAgentOpts = opts;
    }
    run = vi.fn().mockResolvedValue("one-shot response");
    getConversation = vi.fn().mockReturnValue({});
  }
  return { Agent: MockAgent };
});

vi.mock("../../src/core/agents-md.js", () => ({
  loadAgentsMd: vi.fn().mockResolvedValue(null),
  formatAgentsMdBlock: vi.fn((content: string) => `--- AGENTS.md ---\n${content}\n--- END AGENTS.md ---`),
}));

vi.mock("../../src/core/memory.js", () => ({
  loadLearnings: vi.fn().mockResolvedValue([]),
  formatLearningsForPrompt: vi.fn().mockReturnValue(""),
}));

vi.mock("../../src/skills/index.js", () => ({
  loadAllSkills: vi.fn().mockResolvedValue([]),
}));

// Prevent process.exit from actually exiting during tests.
// checkCodexBinary, checkOpenAIKey, checkAnthropicKey are inlined in index.ts.
// We mock the binary check (which is async) via the fs/promises access call it relies on.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    access: vi.fn().mockResolvedValue(undefined), // checkCodexBinary → binary found
  };
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeConfig(): Config {
  return {
    provider: "codex-cli",
    model: "gpt-4o",
    apiKey: "sk-test",           // non-empty → checkOpenAIKey passes
    anthropicApiKey: "sk-ant",   // non-empty → checkAnthropicKey passes
    anthropicMaxTokens: 8192,
    ollamaBaseUrl: undefined,
    fast_model: undefined,
    smart_model: undefined,
    codexPath: "codex",
    systemPrompt: undefined,
    maxTurns: 50,
    timeout: 120_000,
    allowDestructive: false,
    verifyCommand: "npm test",
    requireSpecification: false,
    tools: undefined,
    deny: undefined,
  } as Config;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("oneShotMode — AGENTS.md injection (Sprint 56)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastAgentOpts = {};
  });

  it("passes formatted agentsMdBlock to Agent when AGENTS.md content is present", async () => {
    const { loadAgentsMd, formatAgentsMdBlock } = await import("../../src/core/agents-md.js");
    vi.mocked(loadAgentsMd).mockResolvedValue("# Conventions\nUse TypeScript.");
    vi.mocked(formatAgentsMdBlock).mockReturnValue("--- AGENTS.md ---\n# Conventions\n--- END AGENTS.md ---");

    const { oneShotMode } = await import("../../src/cli/index.js");
    await oneShotMode(makeConfig(), "what does this do?");

    expect(loadAgentsMd).toHaveBeenCalled();
    expect(formatAgentsMdBlock).toHaveBeenCalledWith("# Conventions\nUse TypeScript.");
    expect(lastAgentOpts.agentsMdBlock).toBe("--- AGENTS.md ---\n# Conventions\n--- END AGENTS.md ---");
  });

  it("passes undefined agentsMdBlock to Agent when AGENTS.md is absent", async () => {
    const { loadAgentsMd } = await import("../../src/core/agents-md.js");
    vi.mocked(loadAgentsMd).mockResolvedValue(null);

    const { oneShotMode } = await import("../../src/cli/index.js");
    await oneShotMode(makeConfig(), "what does this do?");

    expect(lastAgentOpts.agentsMdBlock).toBeUndefined();
  });

  it("skips AGENTS.md and continues when loadAgentsMd throws", async () => {
    const { loadAgentsMd } = await import("../../src/core/agents-md.js");
    vi.mocked(loadAgentsMd).mockRejectedValue(new Error("ENOENT"));

    const { oneShotMode } = await import("../../src/cli/index.js");
    // Should not throw — error is caught and logged as a warning
    await expect(oneShotMode(makeConfig(), "what does this do?")).resolves.not.toThrow();
    expect(lastAgentOpts.agentsMdBlock).toBeUndefined();
  });
});
