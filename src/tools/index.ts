import { ToolRegistry } from "./registry.js";
import { fileReadTool } from "./file-read.js";
import { fileWriteTool } from "./file-write.js";
import { createShellTool } from "./shell.js";
import { globTool } from "./glob-tool.js";
import { grepTool } from "./grep-tool.js";
import { createBrowserTool } from "./browser.js";

export interface RegistryOptions {
  allowDestructive?: boolean;
  cwd?: string;
  browserEnabled?: boolean;
}

export function createDefaultRegistry(
  allowDestructiveOrOpts: boolean | RegistryOptions = false,
): ToolRegistry {
  // Accept legacy boolean signature for backward compat
  const opts: RegistryOptions = typeof allowDestructiveOrOpts === "boolean"
    ? { allowDestructive: allowDestructiveOrOpts }
    : allowDestructiveOrOpts;

  const { allowDestructive = false, cwd = process.cwd(), browserEnabled = false } = opts;

  const registry = new ToolRegistry();
  registry.register(fileReadTool);
  registry.register(fileWriteTool);
  registry.register(createShellTool(allowDestructive));
  registry.register(globTool);
  registry.register(grepTool);

  if (browserEnabled) {
    registry.register(createBrowserTool(cwd));
  }

  return registry;
}

export { ToolRegistry } from "./registry.js";
export type { ToolDefinition, ToolResult, OpenAIFunctionDef } from "./types.js";
