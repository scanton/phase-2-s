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
