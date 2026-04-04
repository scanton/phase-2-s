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

  /**
   * Return a new ToolRegistry containing only the tools permitted by the
   * allow/deny configuration.
   *
   * Rules (applied in order):
   *   1. If `allow` is provided, only tools whose names appear in `allow` are kept.
   *   2. If `deny` is provided, any tool whose name appears in `deny` is removed.
   *   3. `deny` always overrides `allow` — it is a security control.
   *
   * Unknown names in either list produce a console warning so typos are visible.
   */
  allowed(allow?: string[], deny?: string[]): ToolRegistry {
    const allNames = this.names();

    // Warn on unrecognized names — silent misconfiguration is a security risk
    for (const name of allow ?? []) {
      if (!allNames.includes(name)) {
        console.warn(`Warning: unknown tool '${name}' in tools (allow) list`);
      }
    }
    for (const name of deny ?? []) {
      if (!allNames.includes(name)) {
        console.warn(`Warning: unknown tool '${name}' in deny list`);
      }
    }

    const filtered = new ToolRegistry();
    for (const tool of this.list()) {
      // Step 1: apply allow-list (if provided)
      if (allow && allow.length > 0 && !allow.includes(tool.name)) continue;
      // Step 2: apply deny-list (deny overrides allow)
      if (deny && deny.includes(tool.name)) continue;
      filtered.register(tool);
    }
    return filtered;
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
