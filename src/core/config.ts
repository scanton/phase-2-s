import { z } from "zod";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { parse as parseYaml } from "yaml";
import { parse as parseToml } from "@iarna/toml";

const configSchema = z.object({
  provider: z.enum(["codex-cli", "openai-api", "anthropic", "ollama", "openrouter", "gemini", "minimax"]).default("codex-cli"),
  /**
   * Model to use. For codex-cli provider, defaults to whatever is in
   * ~/.codex/config.toml so the user's existing Codex setup is respected.
   * For openai-api, defaults to "gpt-4o".
   * For anthropic, defaults to "claude-3-5-sonnet-20241022".
   * For ollama, defaults to "llama3.1:8b" (user must have it pulled).
   * For openrouter, defaults to "openai/gpt-4o".
   * For gemini, defaults to "gemini-2.0-flash".
   */
  model: z.string().optional(),
  fast_model: z.string().optional(),
  smart_model: z.string().optional(),
  apiKey: z.string().optional(),
  anthropicApiKey: z.string().optional(),
  /** Anthropic max_tokens (default 8192; raise for models with higher ceilings). */
  anthropicMaxTokens: z.number().int().min(1).optional(),
  /** Ollama base URL (default http://localhost:11434/v1). */
  ollamaBaseUrl: z.string().optional(),
  /** OpenRouter API key. Falls back to OPENROUTER_API_KEY environment variable. */
  openrouterApiKey: z.string().optional(),
  /** OpenRouter base URL (default https://openrouter.ai/api/v1). Override for custom deployments. */
  openrouterBaseUrl: z.string().optional(),
  /** Gemini API key. Falls back to GEMINI_API_KEY environment variable. Get a free key at https://aistudio.google.com/apikey */
  geminiApiKey: z.string().optional(),
  /** Gemini base URL (default https://generativelanguage.googleapis.com/v1beta/openai/). Override for custom endpoints. */
  geminiBaseUrl: z.string().optional(),
  /** MiniMax API key. Falls back to MINIMAX_API_KEY environment variable. Get a key at https://platform.minimax.io/ */
  minimaxApiKey: z.string().optional(),
  /** MiniMax base URL (default https://api.minimax.io/v1/). Override for custom endpoints. */
  minimaxBaseUrl: z.string().optional(),
  codexPath: z.string().default("codex"),
  systemPrompt: z.string().optional(),
  maxTurns: z.number().default(50),
  timeout: z.number().default(120_000),
  allowDestructive: z.boolean().default(false),
  verifyCommand: z.string().default("npm test"),
  requireSpecification: z.boolean().default(false),
  /**
   * Allow-list: only the named tools are available to the agent.
   * When omitted, all tools are available. `deny` takes precedence over `tools`.
   */
  tools: z.array(z.string()).optional(),
  /**
   * Deny-list: the named tools are blocked even if they appear in `tools`.
   * `deny` always wins — it is a security control, not a preference.
   */
  deny: z.array(z.string()).optional(),
  /**
   * Enable the headless browser tool (requires `playwright` to be installed).
   * Default false — opt-in to avoid requiring playwright on every install.
   */
  browser: z.boolean().default(false),
  /**
   * Settings for `phase2s commit`.
   * `format: "conventional"` generates Conventional Commits format.
   * Currently only "conventional" is accepted. TODO(Sprint 47): add "free-form".
   */
  commit: z.object({
    format: z.literal("conventional").default("conventional"),
  }).optional(),
  /**
   * Notification settings for dark factory runs.
   * `mac: true` sends a macOS system notification via osascript (macOS only).
   * `slack` is a Slack incoming webhook URL.
   * Both are also configurable via PHASE2S_SLACK_WEBHOOK env var.
   */
  notify: z.object({
    mac: z.boolean().optional(),
    slack: z.string().optional(),
    discord: z.string().optional(),
    teams: z.string().optional(),
    telegram: z.object({
      token: z.string(),
      chatId: z.string(),
    }).optional(),
  }).optional(),
  /**
   * Token threshold for automatic context compaction.
   * After each assistant response, if the estimated token count exceeds this
   * value, the session is compacted automatically before the next turn.
   * Token count is estimated by Conversation.estimateTokens().
   * 0 or unset = disabled (default). Set to any positive integer to enable.
   * Example: 80000 triggers compaction when context exceeds ~80k estimated tokens.
   */
  auto_compact_tokens: z.number().int().min(0).optional(),
});

export type Config = z.infer<typeof configSchema> & { model: string };

export async function loadConfig(overrides?: Partial<z.infer<typeof configSchema>>): Promise<Config> {
  let fileConfig: Record<string, unknown> = {};

  // Try loading .phase2s.yaml from current directory
  for (const name of [".phase2s.yaml", ".phase2s.yml"]) {
    try {
      const raw = await readFile(resolve(name), "utf-8");
      const parsed = parseYaml(raw);
      if (parsed === null || parsed === undefined) {
        // Empty file — treat as no config
      } else if (typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(`${name} must be a YAML mapping (key: value), not a ${Array.isArray(parsed) ? "list" : typeof parsed}`);
      } else {
        fileConfig = parsed as Record<string, unknown>;
      }
      break;
    } catch (err) {
      if (err instanceof Error && err.message.includes("must be a YAML")) throw err;
      // Swallow only filesystem "file not found / not readable" errors.
      // Re-throw YAML parse errors so the user sees them (invalid config is not silent).
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "EACCES") throw err;
    }
  }

  // Env vars override file config
  const envConfig: Record<string, unknown> = {};
  if (process.env.OPENAI_API_KEY) envConfig.apiKey = process.env.OPENAI_API_KEY;
  if (process.env.ANTHROPIC_API_KEY) envConfig.anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (process.env.OPENROUTER_API_KEY) envConfig.openrouterApiKey = process.env.OPENROUTER_API_KEY;
  if (process.env.GEMINI_API_KEY) envConfig.geminiApiKey = process.env.GEMINI_API_KEY;
  if (process.env.MINIMAX_API_KEY) envConfig.minimaxApiKey = process.env.MINIMAX_API_KEY;
  if (process.env.PHASE2S_PROVIDER) envConfig.provider = process.env.PHASE2S_PROVIDER;
  if (process.env.PHASE2S_MODEL) envConfig.model = process.env.PHASE2S_MODEL;
  if (process.env.PHASE2S_CODEX_PATH) envConfig.codexPath = process.env.PHASE2S_CODEX_PATH;
  if (process.env.PHASE2S_FAST_MODEL) envConfig.fast_model = process.env.PHASE2S_FAST_MODEL;
  if (process.env.PHASE2S_SMART_MODEL) envConfig.smart_model = process.env.PHASE2S_SMART_MODEL;
  if (process.env.PHASE2S_VERIFY_COMMAND) envConfig.verifyCommand = process.env.PHASE2S_VERIFY_COMMAND;
  // Accept "true", "1", "yes" (case-insensitive) for PHASE2S_ALLOW_DESTRUCTIVE.
  const _destructive = process.env.PHASE2S_ALLOW_DESTRUCTIVE?.toLowerCase();
  if (_destructive === "true" || _destructive === "1" || _destructive === "yes") {
    envConfig.allowDestructive = true;
  }
  // Accept "true", "1", "yes" (case-insensitive) for PHASE2S_BROWSER.
  const _browser = process.env.PHASE2S_BROWSER?.toLowerCase();
  if (_browser === "true" || _browser === "1" || _browser === "yes") {
    envConfig.browser = true;
  }

  const merged = { ...fileConfig, ...envConfig, ...overrides };
  const parsed = configSchema.parse(merged);

  // Resolve model: explicit config > ~/.codex/config.toml > provider default
  if (!parsed.model) {
    parsed.model = await resolveDefaultModel(parsed.provider);
  }

  return parsed as Config;
}

/**
 * Read the model from ~/.codex/config.toml if available (for codex-cli provider),
 * otherwise fall back to a sensible default per provider.
 */
async function resolveDefaultModel(provider: string): Promise<string> {
  if (provider === "codex-cli") {
    try {
      const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
      const raw = await readFile(join(home, ".codex", "config.toml"), "utf-8");
      const toml = parseToml(raw) as Record<string, unknown>;
      if (typeof toml.model === "string" && toml.model) {
        return toml.model;
      }
    } catch {
      // No config file, use default
    }
    return "gpt-4o"; // safe fallback for ChatGPT subscriptions
  }
  if (provider === "anthropic") return "claude-3-5-sonnet-20241022";
  if (provider === "ollama") return "llama3.1:8b"; // user must have this model pulled
  if (provider === "openrouter") return "openai/gpt-4o"; // most common OpenRouter model
  if (provider === "gemini") return "gemini-2.0-flash"; // fast default; gemini-2.5-pro for smart tier
  if (provider === "minimax") return "MiniMax-M2.5"; // default; MiniMax-M2.7 for smart tier
  return "gpt-4o"; // openai-api default
}
