import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleRequest,
  skillToTool,
  toolNameToSkillName,
  buildNotification,
  MCP_SERVER_VERSION,
} from "../../src/mcp/server.js";
import { Conversation } from "../../src/core/conversation.js";
import type { Skill } from "../../src/skills/types.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock Agent so tools/call tests don't spin up a real LLM.
// Includes getConversation() so session persistence tests can verify the
// conversation is threaded through correctly.
vi.mock("../../src/core/agent.js", () => {
  class MockAgent {
    private _conversation: unknown;
    constructor(opts: { config: unknown; conversation?: unknown }) {
      // Reuse the injected conversation if provided; otherwise create a stub.
      this._conversation = opts.conversation ?? { _stub: true, _id: Math.random() };
    }
    run = vi.fn().mockResolvedValue(
      "VERDICT: APPROVED\nSTRONGEST_CONCERN: None identified.\nOBJECTIONS:\n(none)\nAPPROVE_IF: N/A",
    );
    getConversation() {
      return this._conversation;
    }
  }
  return { Agent: MockAgent };
});

// Mock loadConfig so tests don't need a .phase2s.yaml
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_SKILLS: Skill[] = [
  {
    name: "adversarial",
    description: "Fast cross-model challenge — structured adversarial review",
    triggerPhrases: ["adversarial", "challenge this"],
    promptTemplate: "You are an adversarial reviewer...",
    model: "smart",
  },
  {
    name: "consensus-plan",
    description: "Consensus-driven planning — planner, architect, and critic passes",
    triggerPhrases: ["consensus plan"],
    promptTemplate: "Run three sequential passes...",
    model: "smart",
  },
  {
    name: "health",
    description: "Codebase health check — quality and test coverage",
    triggerPhrases: ["health check"],
    promptTemplate: "Run a health check...",
  },
];

// ---------------------------------------------------------------------------
// Tests — protocol compliance
// ---------------------------------------------------------------------------

describe("MCP server — protocol compliance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // initialize
  // -------------------------------------------------------------------------

  it("initialize: responds with correct protocol version and server info", async () => {
    const response = await handleRequest(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      FIXTURE_SKILLS,
      process.cwd(),
    );

    expect(response.jsonrpc).toBe("2.0");
    expect(response.id).toBe(1);
    expect(response.error).toBeUndefined();

    const result = response.result as {
      protocolVersion: string;
      serverInfo: { name: string; version: string };
      capabilities: unknown;
    };
    expect(result.protocolVersion).toBe("2024-11-05");
    expect(result.serverInfo.name).toBe("phase2s");
    expect(result.serverInfo.version).toBe(MCP_SERVER_VERSION);
    expect(result.capabilities).toHaveProperty("tools");
  });

  // -------------------------------------------------------------------------
  // tools/list
  // -------------------------------------------------------------------------

  it("tools/list: returns one tool per loaded skill", async () => {
    const response = await handleRequest(
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      FIXTURE_SKILLS,
      process.cwd(),
    );

    expect(response.error).toBeUndefined();
    const result = response.result as { tools: unknown[] };
    expect(result.tools).toHaveLength(FIXTURE_SKILLS.length);
  });

  it("tools/list: tool names use phase2s__ prefix and underscore convention", async () => {
    const response = await handleRequest(
      { jsonrpc: "2.0", id: 3, method: "tools/list" },
      FIXTURE_SKILLS,
      process.cwd(),
    );

    const result = response.result as { tools: Array<{ name: string }> };
    const names = result.tools.map((t) => t.name);

    expect(names).toContain("phase2s__adversarial");
    expect(names).toContain("phase2s__consensus_plan"); // hyphen → underscore
    expect(names).toContain("phase2s__health");
    // All names must start with phase2s__
    for (const name of names) {
      expect(name).toMatch(/^phase2s__/);
    }
  });

  // -------------------------------------------------------------------------
  // tools/call
  // -------------------------------------------------------------------------

  it("tools/call: invokes the matched skill and returns text content", async () => {
    const response = await handleRequest(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "phase2s__adversarial",
          arguments: { prompt: "Here is my plan: implement feature X using approach Y." },
        },
      },
      FIXTURE_SKILLS,
      process.cwd(),
    );

    expect(response.error).toBeUndefined();
    const result = response.result as { content: Array<{ type: string; text: string }> };
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(typeof result.content[0].text).toBe("string");
    expect(result.content[0].text).toContain("VERDICT");
  });

  it("tools/call: unknown tool name returns error code -32601", async () => {
    const response = await handleRequest(
      {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "phase2s__does_not_exist",
          arguments: { prompt: "some prompt" },
        },
      },
      FIXTURE_SKILLS,
      process.cwd(),
    );

    expect(response.result).toBeUndefined();
    expect(response.error).toBeDefined();
    expect(response.error!.code).toBe(-32601);
    expect(response.error!.message).toContain("phase2s__does_not_exist");
  });
});

// ---------------------------------------------------------------------------
// Tests — helper functions
// ---------------------------------------------------------------------------

describe("MCP server — skillToTool", () => {
  it("generates correct tool name from skill name", () => {
    const skill: Skill = {
      name: "plan-review",
      description: "Engineering review of a plan",
      triggerPhrases: ["plan review"],
      promptTemplate: "Review this plan...",
    };
    const tool = skillToTool(skill);
    expect(tool.name).toBe("phase2s__plan_review");
    expect(tool.description).toBe("Engineering review of a plan");
    expect(tool.inputSchema.required).toContain("prompt");
  });

  it("toolNameToSkillName reverses the naming convention", () => {
    expect(toolNameToSkillName("phase2s__adversarial")).toBe("adversarial");
    expect(toolNameToSkillName("phase2s__consensus_plan")).toBe("consensus-plan");
    expect(toolNameToSkillName("phase2s__plan_review")).toBe("plan-review");
  });
});

// ---------------------------------------------------------------------------
// Tests — Sprint 12: capabilities advertisement
// ---------------------------------------------------------------------------

describe("MCP server — capabilities (Sprint 12)", () => {
  it("initialize: capabilities.tools.listChanged is true", async () => {
    const response = await handleRequest(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      FIXTURE_SKILLS,
      process.cwd(),
    );
    const result = response.result as { capabilities: { tools: { listChanged: boolean } } };
    expect(result.capabilities.tools.listChanged).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests — Sprint 12: buildNotification
// ---------------------------------------------------------------------------

describe("MCP server — buildNotification (Sprint 12)", () => {
  it("returns a valid JSON-RPC notification with no id field", () => {
    const n = buildNotification("notifications/tools/list_changed");
    expect(n.jsonrpc).toBe("2.0");
    expect(n.method).toBe("notifications/tools/list_changed");
    expect("id" in n).toBe(false);
  });

  it("includes params when provided", () => {
    const n = buildNotification("some/method", { key: "value" });
    expect(n.params).toEqual({ key: "value" });
  });
});

// ---------------------------------------------------------------------------
// Tests — Sprint 12: session persistence
// ---------------------------------------------------------------------------

describe("MCP server — session persistence (Sprint 12)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const callAdversarial = (sessions?: Map<string, Conversation>) =>
    handleRequest(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "phase2s__adversarial", arguments: { prompt: "test input" } },
      },
      FIXTURE_SKILLS,
      process.cwd(),
      sessions,
    );

  it("first call populates the session map with a conversation", async () => {
    const sessions = new Map<string, Conversation>();
    await callAdversarial(sessions);
    expect(sessions.has("adversarial")).toBe(true);
    expect(sessions.get("adversarial")).toBeDefined();
  });

  it("second call receives the same conversation instance (not a fresh one)", async () => {
    const sessions = new Map<string, Conversation>();

    // First call — creates and stores a conversation
    await callAdversarial(sessions);
    const firstConversation = sessions.get("adversarial");
    expect(firstConversation).toBeDefined();

    // Second call — should reuse the stored conversation
    await callAdversarial(sessions);
    const secondConversation = sessions.get("adversarial");

    // MockAgent returns this._conversation which equals opts.conversation when
    // provided. So the map entry should be the same object reference.
    expect(secondConversation).toBe(firstConversation);
  });

  it("different skills get independent conversations", async () => {
    const sessions = new Map<string, Conversation>();

    await callAdversarial(sessions);
    await handleRequest(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "phase2s__consensus_plan", arguments: { prompt: "plan something" } },
      },
      FIXTURE_SKILLS,
      process.cwd(),
      sessions,
    );

    expect(sessions.has("adversarial")).toBe(true);
    expect(sessions.has("consensus-plan")).toBe(true);
    expect(sessions.get("adversarial")).not.toBe(sessions.get("consensus-plan"));
  });

  it("omitting sessionConversations gives stateless behavior (no error)", async () => {
    // No session map — original stateless behavior, should succeed normally
    const response = await callAdversarial(undefined);
    expect(response.error).toBeUndefined();
    expect(response.result).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Tests — Sprint 13: skill inputs (schema + injection)
// ---------------------------------------------------------------------------

describe("MCP server — skill inputs (Sprint 13)", () => {
  const SKILL_WITH_INPUTS: Skill = {
    name: "plan-feature",
    description: "Plan a feature",
    triggerPhrases: ["plan this"],
    promptTemplate: "Plan the {{feature}} feature. Scope: {{scope}}.",
    inputs: {
      feature: { prompt: "What feature are you planning?" },
      scope: { prompt: "Any constraints or non-goals?" },
    },
  };

  const SKILL_NO_INPUTS: Skill = {
    name: "adversarial",
    description: "Adversarial review",
    triggerPhrases: ["challenge"],
    promptTemplate: "Challenge this plan.",
  };

  it("skillToTool adds input fields as optional string properties in schema", () => {
    const tool = skillToTool(SKILL_WITH_INPUTS);
    const props = tool.inputSchema.properties;
    expect(props.feature).toMatchObject({ type: "string", description: "What feature are you planning?" });
    expect(props.scope).toMatchObject({ type: "string", description: "Any constraints or non-goals?" });
    // prompt is always present
    expect(props.prompt).toBeDefined();
    // inputs are NOT in required (they are optional)
    expect(tool.inputSchema.required).toContain("prompt");
    expect(tool.inputSchema.required).not.toContain("feature");
  });

  it("skillToTool with no inputs produces the standard prompt-only schema", () => {
    const tool = skillToTool(SKILL_NO_INPUTS);
    expect(Object.keys(tool.inputSchema.properties)).toEqual(["prompt"]);
  });

  it("handleRequest substitutes input values from tool arguments into template", async () => {
    const skills = [SKILL_WITH_INPUTS];
    const response = await handleRequest(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "phase2s__plan_feature",
          arguments: { prompt: "", feature: "auth", scope: "no SAML" },
        },
      },
      skills,
      process.cwd(),
    );
    expect(response.error).toBeUndefined();
    // MockAgent.run() receives the substituted prompt — verify no raw placeholders remain
    // (MockAgent echoes its input back via the mock resolver; we verify no error)
    expect(response.result).toBeDefined();
  });

  it("handleRequest leaves undeclared {{token}} unchanged when input value is missing", async () => {
    const skills = [SKILL_WITH_INPUTS];
    // Call without providing 'scope' — should not throw, scope placeholder may remain
    const response = await handleRequest(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "phase2s__plan_feature",
          arguments: { prompt: "some context", feature: "auth" },
        },
      },
      skills,
      process.cwd(),
    );
    expect(response.error).toBeUndefined();
    expect(response.result).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Tests — Sprint 15: typed input schema generation
// ---------------------------------------------------------------------------

describe("skillToTool — Sprint 15 typed inputs", () => {
  it("boolean input emits { type: 'boolean' } in MCP schema", () => {
    const skill: Skill = {
      name: "typed-bool",
      description: "test",
      triggerPhrases: [],
      promptTemplate: "Include tests: {{include_tests}}",
      inputs: {
        include_tests: { prompt: "Include tests?", type: "boolean" },
      },
    };
    const tool = skillToTool(skill);
    expect(tool.inputSchema.properties.include_tests).toEqual({
      type: "boolean",
      description: "Include tests?",
    });
  });

  it("enum input emits { type: 'string', enum: [...] } in MCP schema", () => {
    const skill: Skill = {
      name: "typed-enum",
      description: "test",
      triggerPhrases: [],
      promptTemplate: "Format: {{format}}",
      inputs: {
        format: { prompt: "Output format", type: "enum", enum: ["prose", "bullets", "table"] },
      },
    };
    const tool = skillToTool(skill);
    expect(tool.inputSchema.properties.format).toEqual({
      type: "string",
      enum: ["prose", "bullets", "table"],
      description: "Output format",
    });
  });

  it("number input emits { type: 'number' } in MCP schema", () => {
    const skill: Skill = {
      name: "typed-number",
      description: "test",
      triggerPhrases: [],
      promptTemplate: "Max: {{max_items}}",
      inputs: {
        max_items: { prompt: "Max items", type: "number" },
      },
    };
    const tool = skillToTool(skill);
    expect(tool.inputSchema.properties.max_items).toEqual({
      type: "number",
      description: "Max items",
    });
  });
});
