import OpenAI from "openai";
import type { Config } from "../core/config.js";
import type { Provider, Message, ProviderEvent, ChatStreamOptions } from "./types.js";
import type { OpenAIFunctionDef } from "../tools/types.js";
import { OpenAIProvider, type OpenAIClientLike } from "./openai.js";

/**
 * OpenRouter provider.
 *
 * OpenRouter is an OpenAI-compatible API gateway that routes requests to
 * 50+ models including Claude, GPT-4o, Gemini, and Llama — all under a
 * single API key. Model names use provider-prefixed slugs:
 *   openai/gpt-4o, anthropic/claude-3-5-sonnet, google/gemini-pro-1.5
 *
 * Implemented via composition with OpenAIProvider: the same streaming
 * tool-call logic applies, just pointed at a different base URL.
 *
 * Set OPENROUTER_API_KEY or openrouterApiKey in .phase2s.yaml.
 * Optional: override the base URL with openrouterBaseUrl for custom deployments.
 */
export class OpenRouterProvider implements Provider {
  name = "openrouter";
  private inner: OpenAIProvider;

  constructor(config: Config, client?: OpenAIClientLike) {
    if (!client && !config.openrouterApiKey) {
      throw new Error(
        "OpenRouter API key is required for the openrouter provider. " +
          "Set OPENROUTER_API_KEY environment variable or openrouterApiKey in .phase2s.yaml",
      );
    }

    const resolvedClient: OpenAIClientLike =
      client ??
      (new OpenAI({
        apiKey: config.openrouterApiKey,
        baseURL: config.openrouterBaseUrl ?? "https://openrouter.ai/api/v1",
        defaultHeaders: {
          // Recommended by OpenRouter for attribution and analytics.
          "HTTP-Referer": "https://github.com/scanton/phase-2-s",
          "X-Title": "Phase2S",
        },
      }) as unknown as OpenAIClientLike);

    // OpenAIProvider validates config.apiKey, so pass the openrouter key there.
    // The real client is already constructed above — OpenAIProvider uses it directly.
    this.inner = new OpenAIProvider(
      { ...config, apiKey: config.openrouterApiKey ?? "" },
      resolvedClient,
    );
  }

  async *chatStream(
    messages: Message[],
    tools: OpenAIFunctionDef[],
    options?: ChatStreamOptions,
  ): AsyncIterable<ProviderEvent> {
    yield* this.inner.chatStream(messages, tools, options);
  }
}
