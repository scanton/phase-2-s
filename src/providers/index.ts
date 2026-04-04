import type { Config } from "../core/config.js";
import type { Provider } from "./types.js";
import { CodexProvider } from "./codex.js";
import { OpenAIProvider } from "./openai.js";

export function createProvider(config: Config): Provider {
  switch (config.provider) {
    case "codex-cli":
      return new CodexProvider(config);
    case "openai-api":
      return new OpenAIProvider(config);
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}

export type { Provider, Message, ToolCall, ProviderEvent } from "./types.js";
export type { OpenAIClientLike } from "./openai.js";
