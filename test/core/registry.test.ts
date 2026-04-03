import { describe, it, expect } from "vitest";
import { z } from "zod";
import { ToolRegistry } from "../../src/tools/registry.js";
import type { ToolDefinition, ToolResult } from "../../src/tools/types.js";

// --- Helpers ---

function makeTool(name: string, result: ToolResult): ToolDefinition {
  return {
    name,
    description: `Test tool: ${name}`,
    parameters: z.object({ input: z.string().optional() }),
    async execute(): Promise<ToolResult> {
      return result;
    },
  };
}

function makeThrowingTool(name: string, message: string): ToolDefinition {
  return {
    name,
    description: `Throwing tool: ${name}`,
    parameters: z.object({ input: z.string().optional() }),
    async execute(): Promise<ToolResult> {
      throw new Error(message);
    },
  };
}

// --- Tests ---

describe("ToolRegistry", () => {
  // --- register / get / list / names ---

  it("registers a tool and retrieves it by name", () => {
    const registry = new ToolRegistry();
    const tool = makeTool("alpha", { success: true, output: "ok" });
    registry.register(tool);
    expect(registry.get("alpha")).toBe(tool);
  });

  it("list() returns all registered tools", () => {
    const registry = new ToolRegistry();
    registry.register(makeTool("a", { success: true, output: "" }));
    registry.register(makeTool("b", { success: true, output: "" }));
    const list = registry.list();
    expect(list).toHaveLength(2);
    expect(list.map((t) => t.name)).toContain("a");
    expect(list.map((t) => t.name)).toContain("b");
  });

  it("names() returns all registered tool names", () => {
    const registry = new ToolRegistry();
    registry.register(makeTool("x", { success: true, output: "" }));
    registry.register(makeTool("y", { success: true, output: "" }));
    expect(registry.names()).toEqual(expect.arrayContaining(["x", "y"]));
  });

  it("toOpenAI() returns OpenAI function definitions for all tools", () => {
    const registry = new ToolRegistry();
    registry.register(makeTool("mytool", { success: true, output: "" }));
    const defs = registry.toOpenAI();
    expect(defs).toHaveLength(1);
    expect(defs[0].type).toBe("function");
    expect(defs[0].function.name).toBe("mytool");
    expect(defs[0].function.description).toContain("mytool");
  });

  // --- execute() happy path ---

  it("executes a registered tool successfully", async () => {
    const registry = new ToolRegistry();
    registry.register(makeTool("ok-tool", { success: true, output: "done" }));
    const result = await registry.execute("ok-tool", {});
    expect(result.success).toBe(true);
    expect(result.output).toBe("done");
  });

  // --- execute() error paths ---

  it("returns error result for unknown tool (no throw)", async () => {
    const registry = new ToolRegistry();
    const result = await registry.execute("nonexistent", {});
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Unknown tool: nonexistent/);
  });

  it("returns error result for invalid arguments (no throw)", async () => {
    const registry = new ToolRegistry();
    // Tool requires 'required_field' (a required string)
    const tool: ToolDefinition = {
      name: "strict-tool",
      description: "requires a field",
      parameters: z.object({ required_field: z.string() }),
      async execute(): Promise<ToolResult> {
        return { success: true, output: "should not reach here" };
      },
    };
    registry.register(tool);
    // Pass an object missing required_field
    const result = await registry.execute("strict-tool", { wrong: 123 });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid arguments for strict-tool/);
  });

  it("catches tool.execute() throws and returns error result", async () => {
    const registry = new ToolRegistry();
    registry.register(makeThrowingTool("boom", "something exploded"));
    const result = await registry.execute("boom", {});
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Tool boom failed/);
    expect(result.error).toMatch(/something exploded/);
  });
});
