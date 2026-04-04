import { ToolRegistry } from "./registry.js";
import { fileReadTool } from "./file-read.js";
import { fileWriteTool } from "./file-write.js";
import { createShellTool } from "./shell.js";
import { globTool } from "./glob-tool.js";
import { grepTool } from "./grep-tool.js";

export function createDefaultRegistry(allowDestructive = false): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(fileReadTool);
  registry.register(fileWriteTool);
  registry.register(createShellTool(allowDestructive));
  registry.register(globTool);
  registry.register(grepTool);
  return registry;
}

export { ToolRegistry } from "./registry.js";
export type { ToolDefinition, ToolResult, OpenAIFunctionDef } from "./types.js";
