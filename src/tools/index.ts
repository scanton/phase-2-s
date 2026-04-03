import { ToolRegistry } from "./registry.js";
import { fileReadTool } from "./file-read.js";
import { fileWriteTool } from "./file-write.js";
import { shellTool } from "./shell.js";
import { globTool } from "./glob-tool.js";
import { grepTool } from "./grep-tool.js";

export function createDefaultRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(fileReadTool);
  registry.register(fileWriteTool);
  registry.register(shellTool);
  registry.register(globTool);
  registry.register(grepTool);
  return registry;
}

export { ToolRegistry } from "./registry.js";
export type { ToolDefinition, ToolResult, OpenAIFunctionDef } from "./types.js";
