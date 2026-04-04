import { z } from "zod";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { parse as parseYaml } from "yaml";
import { parse as parseToml } from "@iarna/toml";

const configSchema = z.object({
  provider: z.enum(["codex-cli", "openai-api"]).default("codex-cli"),
  /**
   * Model to use. For codex-cli provider, defaults to whatever is in
   * ~/.codex/config.toml so the user's existing Codex setup is respected.
   * For openai-api, defaults to "gpt-4o".
   */
  model: z.string().optional(),
  fast_model: z.string().optional(),
  smart_model: z.string().optional(),
  apiKey: z.string().optional(),
  codexPath: z.string().default("codex"),
  systemPrompt: z.string().optional(),
  maxTurns: z.number().default(50),
  timeout: z.number().default(120_000),
  allowDestructive: z.boolean().default(false),
  verifyCommand: z.string().default("npm test"),
  requireSpecification: z.boolean().default(false),
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
  return "gpt-4o"; // direct API default
}
