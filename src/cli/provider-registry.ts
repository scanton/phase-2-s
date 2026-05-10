/**
 * Provider registry — single source of truth for supported provider names,
 * their config-file key fields, and prerequisite hints.
 *
 * All other files (init.ts, config.ts, doctor.ts, index.ts) should import
 * from here rather than hard-coding provider lists inline.
 */

export const PROVIDERS = [
  "codex-cli",
  "openai-api",
  "anthropic",
  "ollama",
  "openrouter",
  "gemini",
  "minimax",
] as const;

export type ProviderName = typeof PROVIDERS[number];

/**
 * Return the YAML config-file field name that stores the API key for a provider.
 * Returns null for providers that don't store a key in the config file
 * (codex-cli and ollama handle auth externally).
 */
export function getProviderKeyField(provider: ProviderName): string | null {
  switch (provider) {
    case "openai-api":    return "apiKey";
    case "anthropic":     return "anthropicApiKey";
    case "openrouter":    return "openrouterApiKey";
    case "gemini":        return "geminiApiKey";
    case "minimax":       return "minimaxApiKey";
    case "codex-cli":
    case "ollama":        return null;
  }
}

export function isValidProvider(name: string): name is ProviderName {
  return (PROVIDERS as readonly string[]).includes(name);
}

/**
 * Known model name prefixes used to detect likely typos in user-supplied model strings.
 *
 * This is a best-effort heuristic, not an authoritative allowlist — unrecognized values
 * pass through with a console.warn (they may be valid provider-specific IDs).
 * Ollama models use "name:tag" format (e.g. "gemma4:latest") and are checked separately
 * by the presence of ":" rather than via this prefix list.
 *
 * Moved from src/goal/parallel-executor.ts (D1: belongs with provider identity code).
 * Update this list when adding support for new providers.
 */
export const KNOWN_MODEL_PREFIXES = [
  "gpt-", "claude-", "o1", "o3",
  "gemini-", "deepseek-", "minimax",
  "openai/", "anthropic/", "google/",
];
