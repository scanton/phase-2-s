/**
 * Isolated unit tests for handleRequest (src/mcp/handler.ts).
 *
 * Imports handleRequest directly (not via server.ts barrel) so these tests
 * exercise handler.ts in isolation. server.test.ts covers the full server
 * integration; this file covers edge cases and the session-persistence path
 * that are harder to reach through the server layer.
 *
 * Mock strategy:
 * - Agent: vi.mock so tools/call doesn't spin up a real LLM
 * - state.ts: vi.mock so state tools don't touch the filesystem
 * - config: pass preloadedConfig to handleRequest to skip disk reads
 * - runGoal / report: vi.mock so goal/report tools don't run real dark factory
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleRequest } from "../../src/mcp/handler.js";
import { Conversation } from "../../src/core/conversation.js";
import type { Skill } from "../../src/skills/types.js";
import type { Config } from "../../src/core/config.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Capture the last Agent constructor opts so tests can assert on agentsMdBlock.
let lastAgentOpts: Record<string, unknown> = {};

vi.mock("../../src/core/agent.js", () => {
  class MockAgent {
    private _conversation: unknown;
    constructor(opts: { config: unknown; conversation?: unknown; agentsMdBlock?: unknown }) {
      lastAgentOpts = opts as Record<string, unknown>;
      this._conversation = opts.conversation ?? { _stub: true, _id: Math.random() };
    }
    run = vi.fn().mockResolvedValue("mocked agent response");
    getConversation() {
      return this._conversation;
    }
  }
  return { Agent: MockAgent };
});

vi.mock("../../src/core/state.js", () => ({
  readRawState: vi.fn().mockReturnValue("stored-value"),
  writeRawState: vi.fn(),
  clearRawState: vi.fn(),
}));

vi.mock("../../src/cli/goal.js", () => ({
  runGoal: vi.fn().mockResolvedValue({
    success: true,
    attempts: 1,
    criteriaResults: { "All tests pass": true },
    runLogPath: "/tmp/test.jsonl",
    challenged: false,
  }),
}));

vi.mock("../../src/cli/report.js", () => ({
  parseRunLog: vi.fn().mockReturnValue([]),
  buildRunReport: vi.fn().mockReturnValue({}),
  formatRunReport: vi.fn().mockReturnValue("Run report text"),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeConfig(): Config {
  return {
    provider: "codex-cli",
    model: "gpt-4o",
    apiKey: undefined,
    anthropicApiKey: undefined,
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

const SKILLS: Skill[] = [
  {
    name: "adversarial",
    description: "Cross-model adversarial review",
    triggerPhrases: [],
    promptTemplate: "You are an adversarial reviewer.",
  },
  {
    name: "my_skill",   // underscore in name — tests the _skillName lookup path
    description: "A skill with underscores in its name",
    triggerPhrases: [],
    promptTemplate: "Do the underscore thing.",
  },
];

const CWD = "/tmp/phase2s-handler-test";
const CONFIG = makeConfig();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("handleRequest — initialize", () => {
  it("returns protocolVersion, capabilities, and serverInfo", async () => {
    const resp = await handleRequest(
      { jsonrpc: "2.0", id: 1, method: "initialize" },
      SKILLS,
      CWD,
      undefined,
      CONFIG,
    );
    expect(resp.result).toMatchObject({
      protocolVersion: "2024-11-05",
      capabilities: { tools: { listChanged: true } },
      serverInfo: { name: "phase2s" },
    });
    expect(resp.error).toBeUndefined();
  });
});

describe("handleRequest — tools/list", () => {
  it("returns skill tools plus state/goal/report tools", async () => {
    const resp = await handleRequest(
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      SKILLS,
      CWD,
      undefined,
      CONFIG,
    );
    const tools = (resp.result as { tools: Array<{ name: string }> }).tools;
    const names = tools.map((t) => t.name);
    // skill tools
    expect(names).toContain("phase2s__adversarial");
    expect(names).toContain("phase2s__my_skill");
    // state tools
    expect(names).toContain("phase2s__state_write");
    expect(names).toContain("phase2s__state_read");
    expect(names).toContain("phase2s__state_clear");
    // goal + report
    expect(names).toContain("phase2s__goal");
    expect(names).toContain("phase2s__report");
  });
});

describe("handleRequest — unknown method", () => {
  it("returns -32601 Method not found for unknown methods", async () => {
    const resp = await handleRequest(
      { jsonrpc: "2.0", id: 3, method: "tools/subscribe" },
      SKILLS,
      CWD,
      undefined,
      CONFIG,
    );
    expect(resp.error?.code).toBe(-32601);
    expect(resp.error?.message).toContain("tools/subscribe");
  });
});

describe("handleRequest — tools/call skill dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls a skill by its MCP tool name and returns content", async () => {
    const resp = await handleRequest(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "phase2s__adversarial", arguments: { prompt: "review this plan" } },
      },
      SKILLS,
      CWD,
      undefined,
      CONFIG,
    );
    expect(resp.error).toBeUndefined();
    const content = (resp.result as { content: Array<{ type: string; text: string }> }).content;
    expect(content[0].type).toBe("text");
    expect(content[0].text).toBe("mocked agent response");
  });

  it("resolves underscore-named skill via _skillName (not lossy toolNameToSkillName)", async () => {
    // my_skill → tool name: phase2s__my_skill
    // toolNameToSkillName would give "my-skill" which doesn't match "my_skill"
    // _skillName lookup finds it correctly
    const resp = await handleRequest(
      {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "phase2s__my_skill", arguments: { prompt: "test" } },
      },
      SKILLS,
      CWD,
      undefined,
      CONFIG,
    );
    expect(resp.error).toBeUndefined();
    const content = (resp.result as { content: Array<{ type: string; text: string }> }).content;
    expect(content[0].text).toBe("mocked agent response");
  });

  it("returns -32601 for an unknown tool name", async () => {
    const resp = await handleRequest(
      {
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: { name: "phase2s__nonexistent_tool", arguments: { prompt: "hi" } },
      },
      SKILLS,
      CWD,
      undefined,
      CONFIG,
    );
    expect(resp.error?.code).toBe(-32601);
    expect(resp.error?.message).toContain("phase2s__nonexistent_tool");
  });
});

describe("handleRequest — state tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("state_write: returns confirmation text", async () => {
    const resp = await handleRequest(
      {
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: { name: "phase2s__state_write", arguments: { key: "sprint", value: { num: 54 } } },
      },
      SKILLS,
      CWD,
      undefined,
      CONFIG,
    );
    expect(resp.error).toBeUndefined();
    const text = (resp.result as { content: Array<{ text: string }> }).content[0].text;
    expect(text).toContain("sprint");
  });

  it("state_write: returns -32602 when key is missing", async () => {
    const resp = await handleRequest(
      {
        jsonrpc: "2.0",
        id: 8,
        method: "tools/call",
        params: { name: "phase2s__state_write", arguments: { value: "no-key" } },
      },
      SKILLS,
      CWD,
      undefined,
      CONFIG,
    );
    expect(resp.error?.code).toBe(-32602);
  });

  it("state_read: returns stored value as JSON string", async () => {
    const resp = await handleRequest(
      {
        jsonrpc: "2.0",
        id: 9,
        method: "tools/call",
        params: { name: "phase2s__state_read", arguments: { key: "sprint" } },
      },
      SKILLS,
      CWD,
      undefined,
      CONFIG,
    );
    expect(resp.error).toBeUndefined();
    const text = (resp.result as { content: Array<{ text: string }> }).content[0].text;
    expect(text).toBe(JSON.stringify("stored-value"));
  });

  it("state_clear: returns confirmation text", async () => {
    const resp = await handleRequest(
      {
        jsonrpc: "2.0",
        id: 10,
        method: "tools/call",
        params: { name: "phase2s__state_clear", arguments: { key: "sprint" } },
      },
      SKILLS,
      CWD,
      undefined,
      CONFIG,
    );
    expect(resp.error).toBeUndefined();
    const text = (resp.result as { content: Array<{ text: string }> }).content[0].text;
    expect(text).toContain("sprint");
  });
});

describe("handleRequest — goal and report validation", () => {
  it("goal: returns -32602 when specFile is missing", async () => {
    const resp = await handleRequest(
      {
        jsonrpc: "2.0",
        id: 11,
        method: "tools/call",
        params: { name: "phase2s__goal", arguments: {} },
      },
      SKILLS,
      CWD,
      undefined,
      CONFIG,
    );
    expect(resp.error?.code).toBe(-32602);
    expect(resp.error?.message).toContain("specFile");
  });

  it("report: returns -32602 when logFile is missing", async () => {
    const resp = await handleRequest(
      {
        jsonrpc: "2.0",
        id: 12,
        method: "tools/call",
        params: { name: "phase2s__report", arguments: {} },
      },
      SKILLS,
      CWD,
      undefined,
      CONFIG,
    );
    expect(resp.error?.code).toBe(-32602);
    expect(resp.error?.message).toContain("logFile");
  });
});

// ---------------------------------------------------------------------------
// agentsMdBlock injection
// ---------------------------------------------------------------------------

describe("handleRequest — agentsMdBlock injection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastAgentOpts = {};
  });

  it("passes agentsMdBlock to Agent constructor when provided", async () => {
    const block = "--- AGENTS.md ---\n# Conventions\nUse TypeScript.\n--- END AGENTS.md ---";
    await handleRequest(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "phase2s__adversarial", arguments: { prompt: "test" } } },
      SKILLS,
      CWD,
      undefined,
      CONFIG,
      block,
    );
    expect(lastAgentOpts.agentsMdBlock).toBe(block);
  });

  it("passes undefined agentsMdBlock to Agent when param is omitted", async () => {
    await handleRequest(
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "phase2s__adversarial", arguments: { prompt: "test" } } },
      SKILLS,
      CWD,
      undefined,
      CONFIG,
      // agentsMdBlock omitted
    );
    expect(lastAgentOpts.agentsMdBlock).toBeUndefined();
  });
});

describe("handleRequest — session persistence", () => {
  it("stores Conversation after first call and reuses it on second call for same skill", async () => {
    const sessionConversations = new Map<string, Conversation>();
    const req = {
      jsonrpc: "2.0" as const,
      id: 13,
      method: "tools/call",
      params: { name: "phase2s__adversarial", arguments: { prompt: "first call" } },
    };

    // First call — no existing conversation in the map
    await handleRequest(req, SKILLS, CWD, sessionConversations, CONFIG);

    // After the first call, the map should have an entry for "adversarial"
    expect(sessionConversations.has("adversarial")).toBe(true);
    const storedConversation = sessionConversations.get("adversarial");
    expect(storedConversation).toBeDefined();

    // Second call — the stored conversation should be passed back in
    // (handler reads from map, passes to Agent constructor, Agent returns it via getConversation)
    await handleRequest({ ...req, id: 14 }, SKILLS, CWD, sessionConversations, CONFIG);

    // The conversation in the map should be the same object (identity, not a new one)
    // because MockAgent.getConversation() returns the same _conversation object
    const conversationAfterSecondCall = sessionConversations.get("adversarial");
    expect(conversationAfterSecondCall).toBeDefined();
    // The map was updated with whatever getConversation() returned after the second call
    // Since our mock returns this._conversation (which is the input conversation on second call),
    // the stored object should be stable across calls.
    expect(conversationAfterSecondCall).toBe(storedConversation);
  });
});
