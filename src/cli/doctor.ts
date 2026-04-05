/**
 * phase2s doctor — installation health check.
 *
 * Runs a set of diagnostic checks and reports pass/fail with fix instructions.
 * Designed to answer "why isn't phase2s working?" without reading source code.
 *
 * Pure check functions are exported for testing. runDoctor() handles all IO.
 */

import { spawnSync } from "node:child_process";
import { existsSync, accessSync, mkdirSync, constants } from "node:fs";
import { resolve, join } from "node:path";
import chalk from "chalk";
import { parse as parseYaml } from "yaml";
import { readFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
  /** Printed below the ✗ line when ok is false. */
  fix?: string;
}

// ---------------------------------------------------------------------------
// Pure check functions (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Check that Node.js >= 20 is running.
 */
export function checkNodeVersion(): CheckResult {
  const version = process.version; // e.g. "v22.1.0"
  const major = parseInt(version.slice(1).split(".")[0], 10);
  const ok = major >= 20;
  return {
    name: "Node.js version",
    ok,
    detail: `${version} (required: >= 20)`,
    fix: ok ? undefined : `Upgrade Node.js to v20 or later: https://nodejs.org`,
  };
}

/**
 * Check that the provider binary is available in PATH (codex-cli and ollama only).
 * Returns ok:true immediately for providers that don't need a binary.
 */
export function checkProviderBinary(provider: string, codexPath = "codex"): CheckResult {
  if (provider === "codex-cli") {
    const result = spawnSync(codexPath, ["--version"], { stdio: "pipe" });
    const ok = !result.error && result.status === 0;
    return {
      name: "codex CLI",
      ok,
      detail: ok ? `found (${codexPath})` : "not found in PATH",
      fix: ok ? undefined : "npm install -g @openai/codex",
    };
  }

  if (provider === "ollama") {
    const result = spawnSync("ollama", ["list"], { stdio: "pipe" });
    const ok = !result.error && result.status === 0;
    return {
      name: "ollama",
      ok,
      detail: ok ? "found" : "not found in PATH",
      fix: ok
        ? undefined
        : "Install from https://ollama.com then run: ollama serve",
    };
  }

  // Other providers need no binary
  return { name: "provider binary", ok: true, detail: "N/A" };
}

/**
 * Check authentication / API key availability for the configured provider.
 */
export function checkAuth(
  provider: string,
  config: Record<string, unknown> = {},
): CheckResult {
  switch (provider) {
    case "codex-cli": {
      const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
      const codexDir = join(home, ".codex");
      const ok = existsSync(codexDir);
      return {
        name: "codex authentication",
        ok,
        detail: ok ? `~/.codex/ found` : "~/.codex/ not found",
        fix: ok ? undefined : "Run: codex auth",
      };
    }

    case "openai-api": {
      const key = (config.apiKey as string | undefined) ?? process.env.OPENAI_API_KEY;
      const ok = Boolean(key);
      return {
        name: "OpenAI API key",
        ok,
        detail: ok ? "set" : "missing",
        fix: ok ? undefined : "Set OPENAI_API_KEY or run phase2s init",
      };
    }

    case "anthropic": {
      const key = (config.anthropicApiKey as string | undefined) ?? process.env.ANTHROPIC_API_KEY;
      const ok = Boolean(key);
      return {
        name: "Anthropic API key",
        ok,
        detail: ok ? "set" : "missing",
        fix: ok ? undefined : "Set ANTHROPIC_API_KEY or run phase2s init",
      };
    }

    case "openrouter": {
      const key = (config.openrouterApiKey as string | undefined) ?? process.env.OPENROUTER_API_KEY;
      const ok = Boolean(key);
      return {
        name: "OpenRouter API key",
        ok,
        detail: ok ? "set" : "missing",
        fix: ok ? undefined : "Set OPENROUTER_API_KEY or run phase2s init",
      };
    }

    case "gemini": {
      const key = (config.geminiApiKey as string | undefined) ?? process.env.GEMINI_API_KEY;
      const present = Boolean(key);
      const validPrefix = !key || key.startsWith("AIza");
      return {
        name: "Gemini API key",
        ok: present,
        detail: !present
          ? "missing"
          : !validPrefix
            ? "set (note: Gemini keys normally start with AIza — verify key is correct)"
            : "set",
        fix: !present
          ? "Set GEMINI_API_KEY or run phase2s init. Get a free key at https://aistudio.google.com/apikey"
          : !validPrefix
            ? "Verify you are using a Gemini API key from https://aistudio.google.com/apikey"
            : undefined,
      };
    }

    case "ollama":
      return { name: "auth", ok: true, detail: "N/A (no auth required)" };

    default:
      return { name: "auth", ok: true, detail: "unknown provider" };
  }
}

/**
 * Check that .phase2s.yaml exists and contains a valid provider value.
 * Returns ok:true if the file is absent (config is optional).
 */
export function checkConfigFile(configPath: string): CheckResult {
  if (!existsSync(configPath)) {
    return {
      name: ".phase2s.yaml",
      ok: true,
      detail: "not present (using defaults — run phase2s init to create one)",
    };
  }

  try {
    const raw = readFileSync(configPath, "utf8");
    const parsed = parseYaml(raw) as Record<string, unknown> | null;
    const provider = parsed?.provider as string | undefined;
    const knownProviders = ["codex-cli", "openai-api", "anthropic", "ollama", "openrouter", "gemini"];
    if (provider && !knownProviders.includes(provider)) {
      return {
        name: ".phase2s.yaml",
        ok: false,
        detail: `unknown provider: ${provider}`,
        fix: `Valid providers: ${knownProviders.join(", ")}`,
      };
    }
    const providerStr = provider ? `provider: ${provider}` : "no provider set (using default)";
    return { name: ".phase2s.yaml", ok: true, detail: providerStr };
  } catch {
    return {
      name: ".phase2s.yaml",
      ok: false,
      detail: "could not be parsed",
      fix: "Run phase2s init to regenerate it, or check for YAML syntax errors",
    };
  }
}

/**
 * Check that the .phase2s/ working directory is writable (or can be created).
 */
export function checkWorkDir(dirPath: string): CheckResult {
  try {
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true });
    }
    accessSync(dirPath, constants.W_OK);
    return { name: ".phase2s/", ok: true, detail: "writable" };
  } catch {
    return {
      name: ".phase2s/",
      ok: false,
      detail: "not writable",
      fix: `Check permissions on ${dirPath}`,
    };
  }
}

// ---------------------------------------------------------------------------
// runDoctor — entry point
// ---------------------------------------------------------------------------

export async function runDoctor(): Promise<void> {
  console.log(chalk.bold("\n  Phase2S doctor\n"));

  // Load existing config to inform checks (best-effort — errors are surfaced by checkConfigFile)
  const configPath = resolve(".phase2s.yaml");
  let existingConfig: Record<string, unknown> = {};
  let provider = "codex-cli";
  try {
    if (existsSync(configPath)) {
      const raw = readFileSync(configPath, "utf8");
      const parsed = parseYaml(raw) as Record<string, unknown> | null;
      if (parsed && typeof parsed === "object") {
        existingConfig = parsed;
        provider = (parsed.provider as string) ?? "codex-cli";
      }
    }
  } catch {
    // checkConfigFile will report this; we continue with defaults
  }

  const checks: CheckResult[] = [
    checkNodeVersion(),
    checkProviderBinary(provider, (existingConfig.codexPath as string) ?? "codex"),
    checkAuth(provider, existingConfig),
    checkConfigFile(configPath),
    checkWorkDir(resolve(".phase2s")),
  ];

  // Filter out N/A checks (provider binary for non-binary providers)
  const relevant = checks.filter((c) => c.detail !== "N/A");

  let failCount = 0;
  for (const check of relevant) {
    if (check.ok) {
      console.log(chalk.green(`  ✓  ${check.name}`) + chalk.dim(`  ${check.detail}`));
    } else {
      failCount++;
      console.log(chalk.red(`  ✗  ${check.name}`) + chalk.dim(`  ${check.detail}`));
      if (check.fix) {
        console.log(chalk.dim(`       ${check.fix}`));
      }
    }
  }

  console.log("");
  if (failCount === 0) {
    console.log(chalk.green("  All checks passed. Phase2S is ready."));
  } else {
    const plural = failCount === 1 ? "issue" : "issues";
    console.log(chalk.yellow(`  ${failCount} ${plural} found. Run phase2s init to reconfigure.`));
  }
  console.log("");
}
