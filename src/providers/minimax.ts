import OpenAI from "openai";
import type { Config } from "../core/config.js";
import type { Provider, Message, ProviderEvent, ChatStreamOptions } from "./types.js";
import type { OpenAIFunctionDef } from "../tools/types.js";
import { OpenAIProvider, type OpenAIClientLike } from "./openai.js";

/**
 * MiniMax provider.
 *
 * MiniMax exposes an OpenAI-compatible REST API at:
 *   https://api.minimax.io/v1
 *
 * Same composition pattern as Gemini and OpenRouter — reuses
 * OpenAIProvider's full streaming tool-call logic. No additional
 * SDK dependency.
 *
 * Model names are MiniMax model slugs:
 *   MiniMax-M2.5 (default), MiniMax-M2.7, MiniMax-M2.1
 *
 * Get an API key at: https://platform.minimax.io/
 *
 * Set MINIMAX_API_KEY environment variable or minimaxApiKey in .phase2s.yaml.
 * Optional: override base URL with minimaxBaseUrl for custom endpoints.
 */
export class MiniMaxProvider implements Provider {
  name = "minimax";
  private inner: OpenAIProvider;

  constructor(config: Config, client?: OpenAIClientLike) {
    if (!client && !config.minimaxApiKey) {
      throw new Error(
        "MiniMax API key is required for the minimax provider. " +
          "Set MINIMAX_API_KEY environment variable or minimaxApiKey in .phase2s.yaml. " +
          "Get a key at https://platform.minimax.io/",
      );
    }

    // Ensure baseURL has a trailing slash — OpenAI SDK path joins require it.
    const rawBaseURL =
      config.minimaxBaseUrl ?? "https://api.minimax.io/v1/";
    const baseURL = rawBaseURL.endsWith("/") ? rawBaseURL : `${rawBaseURL}/`;

    const resolvedClient: OpenAIClientLike =
      client ??
      (new OpenAI({
        apiKey: config.minimaxApiKey,
        baseURL,
      }) as unknown as OpenAIClientLike);

    this.inner = new OpenAIProvider(config, resolvedClient);
  }

  async *chatStream(
    messages: Message[],
    tools: OpenAIFunctionDef[],
    options?: ChatStreamOptions,
  ): AsyncIterable<ProviderEvent> {
    yield* this.inner.chatStream(messages, tools, options);
  }
}
