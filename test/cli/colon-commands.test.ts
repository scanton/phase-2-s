/**
 * Tests for src/cli/colon-commands.ts — handleColonCommand dispatcher.
 *
 * Uses a minimal in-memory agentDefs map (no filesystem) so tests are fast
 * and fully isolated. One describe block per command family.
 */
import { describe, it, expect } from "vitest";
import { handleColonCommand, type ColonCommandCtx } from "../../src/cli/colon-commands.js";
import type { AgentDef } from "../../src/core/agent-loader.js";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeAgentDef(id: string, aliases: string[]): AgentDef {
  return {
    id,
    title: id.charAt(0).toUpperCase() + id.slice(1),
    model: "smart",
    tools: ["file_read"],
    aliases,
    systemPrompt: `You are ${id}.`,
    isBuiltIn: true,
  };
}

function makeCtx(): ColonCommandCtx {
  const apollo = makeAgentDef("apollo", [":ask"]);
  const athena = makeAgentDef("athena", [":plan"]);
  const ares = makeAgentDef("ares", [":build"]);

  const map = new Map<string, AgentDef>();
  // Keyed by bare id AND aliases — same as loadAgents()
  for (const def of [apollo, athena, ares]) {
    map.set(def.id, def);
    for (const alias of def.aliases) map.set(alias, def);
  }

  return {
    agentDefs: map,
    config: { smart_model: "claude-opus-4-5", fast_model: "gpt-4o-mini", model: "gpt-4o" },
  };
}

// ---------------------------------------------------------------------------
// not_handled — plain text, :clone, :commit
// ---------------------------------------------------------------------------

describe("not_handled — non-commands", () => {
  it("plain text passes through", () => {
    expect(handleColonCommand("hello world", makeCtx())).toEqual({ type: "not_handled" });
  });

  it("empty string passes through", () => {
    expect(handleColonCommand("", makeCtx())).toEqual({ type: "not_handled" });
  });

  it(":clone <uuid> is not_handled (owned by REPL loop)", () => {
    expect(handleColonCommand(":clone abc-123", makeCtx())).toEqual({ type: "not_handled" });
  });

  it(":clone with no args is not_handled", () => {
    expect(handleColonCommand(":clone", makeCtx())).toEqual({ type: "not_handled" });
  });

  it(":commit is not_handled (owned by REPL loop)", () => {
    expect(handleColonCommand(":commit", makeCtx())).toEqual({ type: "not_handled" });
  });

  it(":commit with text is not_handled", () => {
    expect(handleColonCommand(":commit fix bug", makeCtx())).toEqual({ type: "not_handled" });
  });
});

// ---------------------------------------------------------------------------
// :re — reasoning tier switching
// ---------------------------------------------------------------------------

describe(":re — reasoning tier", () => {
  it(":re with no arg returns show_reasoning", () => {
    expect(handleColonCommand(":re", makeCtx())).toEqual({ type: "show_reasoning" });
  });

  it(":re high returns set_reasoning(high)", () => {
    expect(handleColonCommand(":re high", makeCtx())).toEqual({ type: "set_reasoning", tier: "high" });
  });

  it(":re low returns set_reasoning(low)", () => {
    expect(handleColonCommand(":re low", makeCtx())).toEqual({ type: "set_reasoning", tier: "low" });
  });

  it(":re default returns set_reasoning(undefined)", () => {
    expect(handleColonCommand(":re default", makeCtx())).toEqual({ type: "set_reasoning", tier: undefined });
  });

  it(":re HIGH is case-insensitive", () => {
    expect(handleColonCommand(":re HIGH", makeCtx())).toEqual({ type: "set_reasoning", tier: "high" });
  });

  it(":re Low is case-insensitive", () => {
    expect(handleColonCommand(":re Low", makeCtx())).toEqual({ type: "set_reasoning", tier: "low" });
  });

  it(":re  high with double-space is handled correctly", () => {
    expect(handleColonCommand(":re  high", makeCtx())).toEqual({ type: "set_reasoning", tier: "high" });
  });

  it(":re foo returns error with message", () => {
    const result = handleColonCommand(":re foo", makeCtx());
    expect(result.type).toBe("error");
    expect((result as { type: "error"; message: string }).message).toContain("foo");
    expect((result as { type: "error"; message: string }).message).toContain("high | low | default");
  });
});

// ---------------------------------------------------------------------------
// :agents
// ---------------------------------------------------------------------------

describe(":agents", () => {
  it(":agents returns list_agents", () => {
    expect(handleColonCommand(":agents", makeCtx())).toEqual({ type: "list_agents" });
  });
});

// ---------------------------------------------------------------------------
// Agent switching — all three forms
// ---------------------------------------------------------------------------

describe("agent switching", () => {
  // Aliases (colon-prefixed)
  it(":build → switch_agent(ares)", () => {
    const result = handleColonCommand(":build", makeCtx());
    expect(result.type).toBe("switch_agent");
    expect((result as { type: "switch_agent"; agentId: string }).agentId).toBe("ares");
  });

  it(":ask → switch_agent(apollo)", () => {
    const result = handleColonCommand(":ask", makeCtx());
    expect(result.type).toBe("switch_agent");
    expect((result as { type: "switch_agent"; agentId: string }).agentId).toBe("apollo");
  });

  it(":plan → switch_agent(athena)", () => {
    const result = handleColonCommand(":plan", makeCtx());
    expect(result.type).toBe("switch_agent");
    expect((result as { type: "switch_agent"; agentId: string }).agentId).toBe("athena");
  });

  // Colon-prefixed bare ids (documented in docs/agents.md)
  it(":ares → switch_agent(ares)", () => {
    const result = handleColonCommand(":ares", makeCtx());
    expect(result.type).toBe("switch_agent");
    expect((result as { type: "switch_agent"; agentId: string }).agentId).toBe("ares");
  });

  it(":apollo → switch_agent(apollo)", () => {
    const result = handleColonCommand(":apollo", makeCtx());
    expect(result.type).toBe("switch_agent");
    expect((result as { type: "switch_agent"; agentId: string }).agentId).toBe("apollo");
  });

  it(":athena → switch_agent(athena)", () => {
    const result = handleColonCommand(":athena", makeCtx());
    expect(result.type).toBe("switch_agent");
    expect((result as { type: "switch_agent"; agentId: string }).agentId).toBe("athena");
  });

  // Bare ids without colon — documented behavior (docs/agents.md: "ares — Same as :build")
  it("ares (no colon) → switch_agent(ares)", () => {
    const result = handleColonCommand("ares", makeCtx());
    expect(result.type).toBe("switch_agent");
    expect((result as { type: "switch_agent"; agentId: string }).agentId).toBe("ares");
  });

  it("apollo (no colon) → switch_agent(apollo)", () => {
    const result = handleColonCommand("apollo", makeCtx());
    expect(result.type).toBe("switch_agent");
    expect((result as { type: "switch_agent"; agentId: string }).agentId).toBe("apollo");
  });

  // :agent <id> explicit form
  it(":agent ares → switch_agent(ares)", () => {
    const result = handleColonCommand(":agent ares", makeCtx());
    expect(result.type).toBe("switch_agent");
    expect((result as { type: "switch_agent"; agentId: string }).agentId).toBe("ares");
  });

  it(":agent apollo → switch_agent(apollo)", () => {
    const result = handleColonCommand(":agent apollo", makeCtx());
    expect(result.type).toBe("switch_agent");
    expect((result as { type: "switch_agent"; agentId: string }).agentId).toBe("apollo");
  });

  it(":agent unknown → unknown_agent('unknown')", () => {
    const result = handleColonCommand(":agent unknown", makeCtx());
    expect(result.type).toBe("unknown_agent");
    expect((result as { type: "unknown_agent"; requestedId: string }).requestedId).toBe("unknown");
  });

  it(":agent with empty id (trailing space) → unknown_agent('')", () => {
    const result = handleColonCommand(":agent ", makeCtx());
    expect(result.type).toBe("unknown_agent");
    expect((result as { type: "unknown_agent"; requestedId: string }).requestedId).toBe("");
  });

  it("switch_agent result includes the full AgentDef", () => {
    const result = handleColonCommand(":build", makeCtx());
    expect(result.type).toBe("switch_agent");
    const switchResult = result as { type: "switch_agent"; agentId: string; agentDef: AgentDef };
    expect(switchResult.agentDef.id).toBe("ares");
    expect(switchResult.agentDef.aliases).toContain(":build");
  });
});

// ---------------------------------------------------------------------------
// Unknown colon commands
// ---------------------------------------------------------------------------

describe("unknown colon commands", () => {
  it(":xyz returns unknown_command", () => {
    const result = handleColonCommand(":xyz", makeCtx());
    expect(result.type).toBe("unknown_command");
    expect((result as { type: "unknown_command"; command: string }).command).toBe(":xyz");
  });

  it(":foo bar returns unknown_command", () => {
    const result = handleColonCommand(":foo bar", makeCtx());
    expect(result.type).toBe("unknown_command");
  });

  it(":refoo is NOT treated as :re (no space boundary)", () => {
    // :refoo does not start with ":re " nor equal ":re" — falls to unknown_command
    const result = handleColonCommand(":refoo", makeCtx());
    expect(result.type).toBe("unknown_command");
  });
});

// ---------------------------------------------------------------------------
// :goal — run a goal spec from within the REPL
// ---------------------------------------------------------------------------

describe(":goal — run spec from REPL", () => {
  it(":goal <path> returns run_goal with goalPath", () => {
    const result = handleColonCommand(":goal specs/auth.md", makeCtx());
    expect(result.type).toBe("run_goal");
    expect((result as { type: "run_goal"; goalPath: string; goalArgs: string[] }).goalPath).toBe("specs/auth.md");
    expect((result as { type: "run_goal"; goalPath: string; goalArgs: string[] }).goalArgs).toEqual([]);
  });

  it(":goal with quoted path containing spaces", () => {
    const result = handleColonCommand(":goal \"my specs/auth spec.md\"", makeCtx());
    expect(result.type).toBe("run_goal");
    expect((result as { type: "run_goal"; goalPath: string; goalArgs: string[] }).goalPath).toBe("my specs/auth spec.md");
  });

  it(":goal with single-quoted path", () => {
    const result = handleColonCommand(":goal 'my spec.md'", makeCtx());
    expect(result.type).toBe("run_goal");
    expect((result as { type: "run_goal"; goalPath: string; goalArgs: string[] }).goalPath).toBe("my spec.md");
  });

  it(":goal with no path returns error", () => {
    const result = handleColonCommand(":goal", makeCtx());
    expect(result.type).toBe("error");
    expect((result as { type: "error"; message: string }).message).toContain(":goal");
  });

  it(":goal with trailing spaces and no path returns error", () => {
    const result = handleColonCommand(":goal   ", makeCtx());
    expect(result.type).toBe("error");
  });
});
