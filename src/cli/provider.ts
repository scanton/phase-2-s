/**
 * Provider subcommand handlers — list, login, logout.
 *
 * Config edits use yaml.parse / patch / yaml.stringify to preserve all
 * unrecognized fields (webhooks, systemPrompt, tools, deny, browser, etc.)
 * that formatConfig() would silently drop.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import * as readline from "node:readline";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import chalk from "chalk";
import { PROVIDERS, getProviderKeyField, isValidProvider, type ProviderName } from "./provider-registry.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function detectConfigPath(): string | null {
  if (existsSync(".phase2s.yml")) return ".phase2s.yml";
  if (existsSync(".phase2s.yaml")) return ".phase2s.yaml";
  return null;
}

function readConfigRaw(configPath: string): Record<string, unknown> {
  const raw = readFileSync(configPath, "utf-8");
  const parsed = yamlParse(raw);
  return (parsed && typeof parsed === "object" && !Array.isArray(parsed))
    ? (parsed as Record<string, unknown>)
    : {};
}

function writeConfigRaw(configPath: string, data: Record<string, unknown>): void {
  writeFileSync(configPath, yamlStringify(data), "utf-8");
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

export function runProviderList(): void {
  const configPath = detectConfigPath();
  let activeProvider: string | undefined;

  if (configPath) {
    const config = readConfigRaw(configPath);
    activeProvider = typeof config.provider === "string" ? config.provider : undefined;
  }

  const envOverride = process.env.PHASE2S_PROVIDER;

  for (const p of PROVIDERS) {
    const isActive = p === activeProvider;
    const marker = isActive ? chalk.green(" (active)") : "";
    process.stdout.write(`  ${p}${marker}\n`);
  }

  if (envOverride) {
    process.stdout.write(chalk.yellow(`\n⚠  overridden by PHASE2S_PROVIDER=${envOverride}\n`));
  }
}

// ---------------------------------------------------------------------------
// login
// ---------------------------------------------------------------------------

async function promptProvider(): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    process.stdout.write("Supported providers: " + PROVIDERS.join(", ") + "\n");
    rl.question("Provider: ", (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function promptApiKey(keyField: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${keyField}: `, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function runProviderLogin(providerArg: string | undefined): Promise<void> {
  let providerName: string = providerArg ?? "";

  if (!providerName) {
    providerName = await promptProvider();
  }

  if (!isValidProvider(providerName)) {
    process.stderr.write(chalk.red(`✖  Unknown provider: "${providerName}". Supported: ${PROVIDERS.join(", ")}\n`));
    process.exit(1);
  }

  const provider = providerName as ProviderName;
  const keyField = getProviderKeyField(provider);

  // Determine config file path (detect existing, default to .phase2s.yaml)
  const configPath = detectConfigPath() ?? ".phase2s.yaml";
  const config: Record<string, unknown> = existsSync(configPath) ? readConfigRaw(configPath) : {};

  // Update provider field
  config.provider = provider;

  // Clear model so loadConfig() re-resolves the correct default for the new provider
  delete config.model;

  // Update key field
  if (keyField) {
    const apiKey = await promptApiKey(keyField);
    if (!apiKey) {
      process.stderr.write(chalk.red(`✖  API key cannot be empty.\n`));
      process.exit(1);
    }
    config[keyField] = apiKey;
  }

  writeConfigRaw(configPath, config);
  process.stdout.write(chalk.green(`✔  Logged in to ${provider}\n`));
}

// ---------------------------------------------------------------------------
// logout
// ---------------------------------------------------------------------------

export function runProviderLogout(): void {
  const configPath = detectConfigPath();

  if (!configPath) {
    process.stderr.write(chalk.red("✖  No .phase2s.yaml or .phase2s.yml found in the current directory.\n"));
    process.exit(1);
  }

  const config = readConfigRaw(configPath);
  const activeProvider = typeof config.provider === "string" ? config.provider : undefined;

  if (!activeProvider || !isValidProvider(activeProvider)) {
    process.stderr.write(chalk.yellow("⚠  No provider configured in config file.\n"));
    return;
  }

  const provider = activeProvider as ProviderName;
  const keyField = getProviderKeyField(provider);

  if (!keyField) {
    // No key stored in file for this provider (codex-cli or ollama)
    const hint = provider === "codex-cli" ? " Run `codex logout` to clear Codex auth." : "";
    process.stdout.write(chalk.blue(`i  No credentials stored locally for ${provider}.${hint}\n`));
    return;
  }

  if (config[keyField] === undefined) {
    process.stdout.write(chalk.yellow(`⚠  No ${keyField} found in ${configPath} — nothing to clear.\n`));
    return;
  }

  delete config[keyField];
  writeConfigRaw(configPath, config);
  process.stdout.write(chalk.green(`✔  Cleared ${provider} API key from ${configPath}\n`));
}
