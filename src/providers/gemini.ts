import OpenAI from "openai";
import type { Config } from "../core/config.js";
import type { Provider, Message, ProviderEvent, ChatStreamOptions } from "./types.js";
import type { OpenAIFunctionDef } from "../tools/types.js";
import { OpenAIProvider, type OpenAIClientLike } from "./openai.js";

/**
 * Google Gemini provider.
 *
 * Gemini exposes an OpenAI-compatible REST API at:
 *   https://generativelanguage.googleapis.com/v1beta/openai/
 *
 * This means we can reuse OpenAIProvider's full streaming tool-call logic
 * — same composition pattern as OpenRouter. No additional SDK dependency.
 *
 * Model names are Gemini model slugs without provider prefix:
 *   gemini-2.0-flash (default), gemini-2.5-pro, gemini-1.5-pro
 *
 * Get an API key (including free tier) at: https://aistudio.google.com/apikey
 * Keys start with "AIza".
 *
 * Set GEMINI_API_KEY environment variable or geminiApiKey in .phase2s.yaml.
 * Optional: override base URL with geminiBaseUrl for custom endpoints.
 */
export class GeminiProvider implements Provider {
  name = "gemini";
  private inner: OpenAIProvider;

  constructor(config: Config, client?: OpenAIClientLike) {
    if (!client && !config.geminiApiKey) {
      throw new Error(
        "Gemini API key is required for the gemini provider. " +
          "Set GEMINI_API_KEY environment variable or geminiApiKey in .phase2s.yaml. " +
          "Get a free key at https://aistudio.google.com/apikey",
      );
    }

    const resolvedClient: OpenAIClientLike =
      client ??
      (new OpenAI({
        apiKey: config.geminiApiKey,
        baseURL:
          config.geminiBaseUrl ??
          "https://generativelanguage.googleapis.com/v1beta/openai/",
      }) as unknown as OpenAIClientLike);

    // OpenAIProvider validates config.apiKey — pass the Gemini key there.
    // The real client is already constructed above; OpenAIProvider uses it directly.
    this.inner = new OpenAIProvider(
      { ...config, apiKey: config.geminiApiKey ?? "" },
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
