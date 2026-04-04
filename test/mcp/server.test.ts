import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleRequest, skillToTool, toolNameToSkillName, MCP_SERVER_VERSION } from "../../src/mcp/server.js";
import type { Skill } from "../../src/skills/types.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock Agent so tools/call tests don't spin up a real LLM.
// Must use a class (not an arrow function) because Agent is used with `new`.
vi.mock("../../src/core/agent.js", () => {
  class MockAgent {
    run = vi.fn().mockResolvedValue(
      "VERDICT: APPROVED\nSTRONGEST_CONCERN: None identified.\nOBJECTIONS:\n(none)\nAPPROVE_IF: N/A",
    );
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
// Tests
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
// Helper function tests
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
