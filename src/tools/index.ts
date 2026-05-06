import { ToolRegistry } from "./registry.js";
import { createFileReadTool } from "./file-read.js";
import { createFileWriteTool } from "./file-write.js";
import { createShellTool } from "./shell.js";
import { createGlobTool } from "./glob-tool.js";
import { createGrepTool } from "./grep-tool.js";
import { createBrowserTool } from "./browser.js";
import { createCodeSearchTool } from "./code-search.js";

export interface RegistryOptions {
  allowDestructive?: boolean;
  cwd?: string;
  browserEnabled?: boolean;
  /** Ollama base URL. When set alongside ollamaEmbedModel, enables code_search tool. */
  ollamaBaseUrl?: string;
  /** Ollama embedding model. Required together with ollamaBaseUrl for code_search. */
  ollamaEmbedModel?: string;
}

export function createDefaultRegistry(
  allowDestructiveOrOpts: boolean | RegistryOptions = false,
): ToolRegistry {
  // Accept legacy boolean signature for backward compat
  const opts: RegistryOptions = typeof allowDestructiveOrOpts === "boolean"
    ? { allowDestructive: allowDestructiveOrOpts }
    : allowDestructiveOrOpts;

  const {
    allowDestructive = false,
    cwd = process.cwd(),
    browserEnabled = false,
    ollamaBaseUrl,
    ollamaEmbedModel,
  } = opts;

  const registry = new ToolRegistry();
  registry.register(createFileReadTool(cwd));
  registry.register(createFileWriteTool(cwd));
  registry.register(createShellTool(allowDestructive, cwd));
  registry.register(createGlobTool(cwd));
  registry.register(createGrepTool(cwd));

  if (browserEnabled) {
    registry.register(createBrowserTool(cwd));
  }

  if (ollamaBaseUrl && ollamaEmbedModel) {
    registry.register(createCodeSearchTool(cwd, ollamaBaseUrl, ollamaEmbedModel));
  }

  return registry;
}

export { ToolRegistry } from "./registry.js";
export type { ToolDefinition, ToolResult, OpenAIFunctionDef } from "./types.js";
