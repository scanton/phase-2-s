import OpenAI from "openai";
import type { Config } from "../core/config.js";
import type { Provider } from "./types.js";
import { OpenAIProvider, type OpenAIClientLike } from "./openai.js";
import { log } from "../utils/logger.js";

/**
 * Ollama provider — wraps OpenAIProvider with Ollama's OpenAI-compatible base URL.
 *
 * Ollama exposes an OpenAI-compatible API at http://localhost:11434/v1 (default).
 * No new class needed — inject a pre-configured OpenAI client into OpenAIProvider.
 * The `name` field is overridden so logs and tests see "ollama" not "openai-api".
 *
 * Prerequisites:
 *   - `ollama serve` must be running
 *   - The target model must be pulled: `ollama pull <model>`
 *
 * Recommended models for tool-calling skills (/satori, /consensus-plan):
 *   qwen2.5-coder:7b or llama3.1:8b — both support function calling via Ollama.
 *   llama3.2 (3B) may drop tool calls on complex prompts.
 *
 * Rate limiting: local Ollama inference rarely returns HTTP 429 — it is bounded
 * by local GPU/CPU capacity, not API quotas. If a remote Ollama server does return
 * 429, the underlying OpenAIProvider auto-backoff logic handles it transparently
 * (inherited via composition). No special handling needed here.
 *
 * TODO: If Ollama adds explicit rate-limit support (e.g. --max-concurrency), consider
 * tuning rate_limit_backoff_threshold downward for local runners (short resets).
 */
function isLocalUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

export function createOllamaProvider(config: Config): Provider {
  const baseURL = config.ollamaBaseUrl ?? "http://localhost:11434/v1";
  if (!isLocalUrl(baseURL)) {
    log.warn(`Ollama: remote server configured (${baseURL}) — prompts and tool results will be sent to that host. Ensure this is intentional.`);
  }
  // Ollama accepts any non-empty string as API key — required by the OpenAI SDK
  const client = new OpenAI({ baseURL, apiKey: "ollama" }) as unknown as OpenAIClientLike;

  // Pass apiKey: "ollama" so OpenAIProvider skips the "no API key" guard.
  const provider = new OpenAIProvider({ ...config, apiKey: "ollama" }, client);
  // Override the inherited name so logs and tests see "ollama" not "openai-api".
  // OpenAIProvider.name is a public mutable string field, so this cast is safe.
  (provider as unknown as { name: string }).name = "ollama";
  return provider;
}
