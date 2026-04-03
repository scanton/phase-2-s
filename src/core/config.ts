import { z } from "zod";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";

const configSchema = z.object({
  provider: z.enum(["codex-cli", "openai-api"]).default("codex-cli"),
  model: z.string().default("o4-mini"),
  apiKey: z.string().optional(),
  codexPath: z.string().default("codex"),
  systemPrompt: z.string().optional(),
  maxTurns: z.number().default(50),
  timeout: z.number().default(120_000),
});

export type Config = z.infer<typeof configSchema>;

export async function loadConfig(overrides?: Partial<Config>): Promise<Config> {
  let fileConfig: Record<string, unknown> = {};

  // Try loading .phase2s.yaml from current directory
  for (const name of [".phase2s.yaml", ".phase2s.yml"]) {
    try {
      const raw = await readFile(resolve(name), "utf-8");
      fileConfig = parseYaml(raw) ?? {};
      break;
    } catch {
      // File not found, continue
    }
  }

  // Env vars override file config
  const envConfig: Record<string, unknown> = {};
  if (process.env.OPENAI_API_KEY) envConfig.apiKey = process.env.OPENAI_API_KEY;
  if (process.env.PHASE2S_PROVIDER) envConfig.provider = process.env.PHASE2S_PROVIDER;
  if (process.env.PHASE2S_MODEL) envConfig.model = process.env.PHASE2S_MODEL;
  if (process.env.PHASE2S_CODEX_PATH) envConfig.codexPath = process.env.PHASE2S_CODEX_PATH;

  const merged = { ...fileConfig, ...envConfig, ...overrides };
  return configSchema.parse(merged);
}
