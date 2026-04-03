import { ToolDefinition, ToolResult, toolToOpenAI, type OpenAIFunctionDef } from "./types.js";

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  names(): string[] {
    return Array.from(this.tools.keys());
  }

  /** Get all tools as OpenAI function definitions */
  toOpenAI(): OpenAIFunctionDef[] {
    return this.list().map(toolToOpenAI);
  }

  /** Execute a tool by name with parsed arguments */
  async execute(name: string, args: unknown): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        success: false,
        output: "",
        error: `Unknown tool: ${name}`,
      };
    }

    const parsed = tool.parameters.safeParse(args);
    if (!parsed.success) {
      return {
        success: false,
        output: "",
        error: `Invalid arguments for ${name}: ${parsed.error.message}`,
      };
    }

    try {
      return await tool.execute(parsed.data);
    } catch (err) {
      return {
        success: false,
        output: "",
        error: `Tool ${name} failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
