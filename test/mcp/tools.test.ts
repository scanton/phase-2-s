/**
 * Tests for src/mcp/tools.ts — pure functions and constants.
 * No mocking needed: skillToTool, toolNameToSkillName, STATE_TOOLS are all
 * deterministic, side-effect-free utilities.
 */

import { describe, it, expect } from "vitest";
import {
  skillToTool,
  toolNameToSkillName,
  STATE_TOOLS,
  GOAL_TOOL,
  REPORT_TOOL,
  buildNotification,
} from "../../src/mcp/tools.js";
import type { Skill } from "../../src/skills/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    name: "test-skill",
    description: "A test skill",
    triggerPhrases: [],
    promptTemplate: "Do something.",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// skillToTool
// ---------------------------------------------------------------------------

describe("skillToTool", () => {
  it("produces a tool name with phase2s__ prefix and hyphens replaced by underscores", () => {
    const tool = skillToTool(makeSkill({ name: "consensus-plan" }));
    expect(tool.name).toBe("phase2s__consensus_plan");
  });

  it("sets _skillName to the original skill name, preserving hyphens", () => {
    const tool = skillToTool(makeSkill({ name: "consensus-plan" }));
    expect(tool._skillName).toBe("consensus-plan");
  });

  it("uses skill description as tool description", () => {
    const tool = skillToTool(makeSkill({ description: "Run the adversarial review" }));
    expect(tool.description).toBe("Run the adversarial review");
  });

  it("falls back to generic description when skill has no description", () => {
    const tool = skillToTool(makeSkill({ description: "" }));
    expect(tool.description).toContain("test-skill");
  });

  it("always includes 'prompt' as a property in inputSchema", () => {
    const tool = skillToTool(makeSkill());
    expect(tool.inputSchema.properties).toHaveProperty("prompt");
    expect(tool.inputSchema.required).toContain("prompt");
  });

  it("adds no extra properties when skill has no inputs", () => {
    const tool = skillToTool(makeSkill({ inputs: undefined }));
    const propKeys = Object.keys(tool.inputSchema.properties);
    expect(propKeys).toEqual(["prompt"]);
  });

  it("adds declared string inputs as properties", () => {
    const tool = skillToTool(
      makeSkill({
        inputs: {
          mode: { type: "string", prompt: "Which mode?" },
        },
      }),
    );
    expect(tool.inputSchema.properties).toHaveProperty("mode");
    expect((tool.inputSchema.properties["mode"] as { type: string }).type).toBe("string");
  });

  it("adds declared enum inputs with enum values", () => {
    const tool = skillToTool(
      makeSkill({
        inputs: {
          level: { type: "enum", enum: ["low", "medium", "high"], prompt: "Pick level" },
        },
      }),
    );
    const levelProp = tool.inputSchema.properties["level"] as { type: string; enum: string[] };
    expect(levelProp.type).toBe("string");
    expect(levelProp.enum).toEqual(["low", "medium", "high"]);
  });

  it("adds declared boolean inputs as boolean type", () => {
    const tool = skillToTool(
      makeSkill({
        inputs: {
          verbose: { type: "boolean", prompt: "Verbose output?" },
        },
      }),
    );
    expect((tool.inputSchema.properties["verbose"] as { type: string }).type).toBe("boolean");
  });
});

// ---------------------------------------------------------------------------
// toolNameToSkillName
// ---------------------------------------------------------------------------

describe("toolNameToSkillName", () => {
  it("strips the phase2s__ prefix and converts underscores to hyphens", () => {
    expect(toolNameToSkillName("phase2s__consensus_plan")).toBe("consensus-plan");
  });

  it("returns a simple name unchanged after prefix strip", () => {
    expect(toolNameToSkillName("phase2s__adversarial")).toBe("adversarial");
  });

  it("round-trips correctly for hyphen-named skills", () => {
    const skillName = "plan-review";
    const toolName = `phase2s__${skillName.replace(/-/g, "_")}`;
    expect(toolNameToSkillName(toolName)).toBe(skillName);
  });

  it("does NOT correctly reverse underscore-named skills (known limitation fixed by _skillName)", () => {
    // A skill named "my_skill" would become tool "phase2s__my_skill"
    // toolNameToSkillName reverses to "my-skill" — wrong.
    // This is the bug that _skillName on MCPTool was introduced to fix.
    expect(toolNameToSkillName("phase2s__my_skill")).toBe("my-skill"); // lossy — expected
  });
});

// ---------------------------------------------------------------------------
// STATE_TOOLS
// ---------------------------------------------------------------------------

describe("STATE_TOOLS", () => {
  it("contains exactly three tools: state_write, state_read, state_clear", () => {
    const names = STATE_TOOLS.map((t) => t.name);
    expect(names).toEqual([
      "phase2s__state_write",
      "phase2s__state_read",
      "phase2s__state_clear",
    ]);
  });

  it("state_write requires key and value", () => {
    const writeTool = STATE_TOOLS.find((t) => t.name === "phase2s__state_write")!;
    expect(writeTool.inputSchema.required).toContain("key");
    expect(writeTool.inputSchema.required).toContain("value");
  });

  it("state_read requires key", () => {
    const readTool = STATE_TOOLS.find((t) => t.name === "phase2s__state_read")!;
    expect(readTool.inputSchema.required).toContain("key");
  });

  it("state_clear requires key", () => {
    const clearTool = STATE_TOOLS.find((t) => t.name === "phase2s__state_clear")!;
    expect(clearTool.inputSchema.required).toContain("key");
  });

  it("all state tools have non-empty descriptions", () => {
    for (const tool of STATE_TOOLS) {
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// GOAL_TOOL and REPORT_TOOL
// ---------------------------------------------------------------------------

describe("GOAL_TOOL", () => {
  it("has name phase2s__goal", () => {
    expect(GOAL_TOOL.name).toBe("phase2s__goal");
  });

  it("requires specFile", () => {
    expect(GOAL_TOOL.inputSchema.required).toContain("specFile");
  });
});

describe("REPORT_TOOL", () => {
  it("has name phase2s__report", () => {
    expect(REPORT_TOOL.name).toBe("phase2s__report");
  });

  it("requires logFile", () => {
    expect(REPORT_TOOL.inputSchema.required).toContain("logFile");
  });
});

// ---------------------------------------------------------------------------
// buildNotification
// ---------------------------------------------------------------------------

describe("buildNotification", () => {
  it("builds a JSON-RPC notification with no id field", () => {
    const n = buildNotification("notifications/tools/list_changed");
    expect(n.jsonrpc).toBe("2.0");
    expect(n.method).toBe("notifications/tools/list_changed");
    expect("id" in n).toBe(false);
  });

  it("includes params when provided", () => {
    const n = buildNotification("test/method", { foo: "bar" });
    expect(n.params).toEqual({ foo: "bar" });
  });

  it("omits params when not provided", () => {
    const n = buildNotification("test/method");
    expect("params" in n).toBe(false);
  });
});
