import type { Config } from "../core/config.js";
import type { Provider } from "./types.js";
import { CodexProvider } from "./codex.js";
import { OpenAIProvider } from "./openai.js";
import { AnthropicProvider } from "./anthropic.js";
import { createOllamaProvider } from "./ollama.js";
import { OpenRouterProvider } from "./openrouter.js";
import { GeminiProvider } from "./gemini.js";
import { MiniMaxProvider } from "./minimax.js";

export function createProvider(config: Config): Provider {
  switch (config.provider) {
    case "codex-cli":
      return new CodexProvider(config);
    case "openai-api":
      return new OpenAIProvider(config);
    case "anthropic":
      return new AnthropicProvider(config);
    case "ollama":
      return createOllamaProvider(config);
    case "openrouter":
      return new OpenRouterProvider(config);
    case "gemini":
      return new GeminiProvider(config);
    case "minimax":
      return new MiniMaxProvider(config);
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}

export type { Provider, Message, ToolCall, ProviderEvent } from "./types.js";
export type { OpenAIClientLike } from "./openai.js";
export { OpenRouterProvider } from "./openrouter.js";
export { GeminiProvider } from "./gemini.js";
export { MiniMaxProvider } from "./minimax.js";
