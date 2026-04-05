import { ToolDefinition, ToolResult, toolToOpenAI, type OpenAIFunctionDef } from "./types.js";

// ---------------------------------------------------------------------------
// Glob pattern matching
// ---------------------------------------------------------------------------

/**
 * Returns true if `name` matches `pattern`.
 * Supports `*` as a wildcard matching any sequence of characters.
 * With no `*`, falls back to exact string equality.
 *
 * Examples:
 *   matchesPattern("file_read", "file_*") → true
 *   matchesPattern("shell",     "file_*") → false
 *   matchesPattern("shell",     "*")      → true
 *   matchesPattern("shell",     "shell")  → true
 */
function matchesPattern(name: string, pattern: string): boolean {
  if (!pattern.includes("*")) return name === pattern;
  const regex = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
  return regex.test(name);
}

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
   *   1. If `allow` is provided, only tools whose names match a pattern in `allow` are kept.
   *   2. If `deny` is provided, any tool whose name matches a pattern in `deny` is removed.
   *   3. `deny` always overrides `allow` — it is a security control.
   *
   * Patterns support `*` as a wildcard: `file_*` matches `file_read` and `file_write`.
   * Exact names (no `*`) are matched as-is. Patterns that match no registered tools
   * produce a console warning so typos are visible.
   */
  allowed(allow?: string[], deny?: string[]): ToolRegistry {
    const allNames = this.names();

    // Warn on patterns that match no registered tool — catches typos in both exact
    // names and glob patterns.
    for (const pattern of allow ?? []) {
      if (!allNames.some((n) => matchesPattern(n, pattern))) {
        console.warn(`Warning: pattern '${pattern}' in tools (allow) list matches no known tools`);
      }
    }
    for (const pattern of deny ?? []) {
      if (!allNames.some((n) => matchesPattern(n, pattern))) {
        console.warn(`Warning: pattern '${pattern}' in deny list matches no known tools`);
      }
    }

    const filtered = new ToolRegistry();
    for (const tool of this.list()) {
      // Step 1: apply allow-list (if provided)
      if (allow && allow.length > 0 && !allow.some((p) => matchesPattern(tool.name, p))) continue;
      // Step 2: apply deny-list (deny overrides allow)
      if (deny && deny.some((p) => matchesPattern(tool.name, p))) continue;
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
