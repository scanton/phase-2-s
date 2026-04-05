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

    // Ensure baseURL has a trailing slash — OpenAI SDK path joins require it.
    const rawBaseURL =
      config.geminiBaseUrl ?? "https://generativelanguage.googleapis.com/v1beta/openai/";
    const baseURL = rawBaseURL.endsWith("/") ? rawBaseURL : `${rawBaseURL}/`;

    const resolvedClient: OpenAIClientLike =
      client ??
      (new OpenAI({
        apiKey: config.geminiApiKey,
        baseURL,
      }) as unknown as OpenAIClientLike);

    // OpenAIProvider is always given an already-constructed client here, so its
    // config.apiKey validation guard (!client && !config.apiKey) never fires.
    // Pass config as-is — no need to alias the Gemini key into the OpenAI field.
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
