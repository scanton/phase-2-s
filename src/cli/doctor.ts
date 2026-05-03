/**
 * phase2s doctor — installation health check.
 *
 * Runs a set of diagnostic checks and reports pass/fail with fix instructions.
 * Designed to answer "why isn't phase2s working?" without reading source code.
 *
 * Pure check functions are exported for testing. runDoctor() handles all IO.
 */

import { spawnSync } from "node:child_process";
import { existsSync, accessSync, mkdirSync, constants, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import chalk from "chalk";
import { parse as parseYaml } from "yaml";
import { bundledTemplatesDir } from "../skills/loader.js";
import { readSessionIndex, rebuildSessionIndexStrict } from "../core/session.js";
import { PROVIDERS, isValidProvider } from "./provider-registry.js";

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

    case "minimax": {
      const key = (config.minimaxApiKey as string | undefined) ?? process.env.MINIMAX_API_KEY;
      const present = Boolean(key);
      return {
        name: "MiniMax API key",
        ok: present,
        detail: present ? "set" : "missing",
        fix: present
          ? undefined
          : "Set MINIMAX_API_KEY or run phase2s init. Get a key at https://platform.minimax.io/",
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
    if (provider && !isValidProvider(provider)) {
      return {
        name: ".phase2s.yaml",
        ok: false,
        detail: `unknown provider: ${provider}`,
        fix: `Valid providers: ${PROVIDERS.join(", ")}`,
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

/**
 * Check if tmux is available (for --dashboard flag on parallel execution).
 * This check is advisory — tmux is optional.
 */
export function checkTmux(): CheckResult {
  try {
    const result = spawnSync("which", ["tmux"], { encoding: "utf8" });
    if (result?.status === 0) {
      return { name: "tmux", ok: true, detail: "available (for --dashboard)" };
    }
  } catch {
    // spawnSync can fail in sandboxed environments
  }
  return {
    name: "tmux",
    ok: false,
    detail: "not found (optional — needed for --dashboard flag on parallel execution)",
    fix: "Install tmux: brew install tmux (macOS) or apt install tmux (Linux)",
  };
}

/**
 * Check if git worktrees are supported (for parallel execution).
 */
export function checkGitWorktree(): CheckResult {
  try {
    const result = spawnSync("git", ["worktree", "list"], { encoding: "utf8" });
    if (result?.status === 0) {
      return { name: "git worktree", ok: true, detail: "supported" };
    }
  } catch {
    // spawnSync can fail in sandboxed environments
  }
  return {
    name: "git worktree",
    ok: false,
    detail: "not available",
    fix: "Ensure git >= 2.5 is installed for parallel execution support",
  };
}

/**
 * Check that bundled spec templates directory is present and non-empty.
 */
export function checkTemplatesDir(): CheckResult {
  const dir = bundledTemplatesDir();
  if (!existsSync(dir)) {
    return {
      name: "Spec templates",
      ok: false,
      detail: "Bundled templates directory not found",
      fix: "Reinstall phase2s: npm install -g @scanton/phase2s",
    };
  }
  let files: string[];
  try {
    files = readdirSync(dir).filter((f: string) => f.endsWith(".md"));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? "unknown";
    return {
      name: "Spec templates",
      ok: false,
      detail: `Templates directory not readable (${code})`,
      fix: "Check directory permissions or reinstall: npm install -g @scanton/phase2s",
    };
  }
  if (files.length === 0) {
    return {
      name: "Spec templates",
      ok: false,
      detail: "Templates directory exists but contains no templates",
      fix: "Reinstall phase2s: npm install -g @scanton/phase2s",
    };
  }
  return {
    name: "Spec templates",
    ok: true,
    detail: `${files.length} bundled templates found`,
  };
}

/**
 * Check that the ZSH shell integration plugin is installed and sourced.
 *
 * Accepts optional path overrides for testability (same pattern as checkWorkDir).
 */
export function checkShellPlugin(
  phase2sDir: string = join(homedir(), ".phase2s"),
  zshrcPath: string = join(homedir(), ".zshrc"),
): CheckResult {
  // ZSH-only feature — non-ZSH users see a green ✓ "N/A" pass in doctor output.
  // Note: the runDoctor() filter removes checks where detail === "N/A" exactly.
  // This check returns a longer detail string, so it passes the filter and shows
  // as an informational ✓ (not filtered) — which is correct UX for bash users.
  const shell = process.env.SHELL ?? "";
  if (shell && !shell.includes("zsh")) {
    return {
      name: "Shell integration",
      ok: true,
      detail: `N/A (ZSH-only — detected shell: ${shell})`,
    };
  }

  const pluginDest = join(phase2sDir, "phase2s.plugin.zsh");
  const pluginExists = existsSync(pluginDest);

  if (!pluginExists) {
    return {
      name: "Shell integration",
      ok: false,
      detail: "ZSH plugin not installed",
      fix: "Run: phase2s setup",
    };
  }

  // Write-permission check: verify phase2sDir is writable so future upgrades work.
  // Placed here (after plugin-exists confirmation) so we only warn when the dir
  // already exists — we don't try to create it from doctor.
  try {
    accessSync(phase2sDir, constants.W_OK);
  } catch {
    return {
      name: "Shell integration",
      ok: false,
      detail: `Plugin installed but ${phase2sDir} is not writable`,
      fix: `Run: chmod u+w "${phase2sDir}"  (needed for phase2s setup upgrades)`,
    };
  }

  // Check ~/.zshrc contains the source line.
  // Accept both the $HOME-relative form (v1.20.0+) and the legacy absolute
  // path form (pre-1.20.0) for backwards compatibility.
  const homeRelativePluginPath = "$HOME/.phase2s/phase2s.plugin.zsh";
  const zshrcExists = existsSync(zshrcPath);
  let sourced = false;
  if (zshrcExists) {
    try {
      const content = readFileSync(zshrcPath, "utf8");
      sourced = content.includes(homeRelativePluginPath) || content.includes(pluginDest);
    } catch {
      return {
        name: "Shell integration",
        ok: false,
        detail: `Plugin installed but ${zshrcPath} is not readable`,
        fix: `Check permissions on ${zshrcPath}`,
      };
    }
  }

  if (!sourced) {
    return {
      name: "Shell integration",
      ok: false,
      detail: `Plugin installed but not sourced in ${zshrcPath}`,
      fix: "Run: phase2s setup  (re-run is idempotent and adds the source line)",
    };
  }

  return {
    name: "Shell integration",
    ok: true,
    detail: `ZSH plugin installed and sourced`,
  };
}

/**
 * Check that the Bash shell integration plugin is installed and sourced.
 *
 * Follows the exact structure of checkShellPlugin() — see that function for
 * the rationale behind each check (N/A guard, write-permission, source-line).
 * Return type: CheckResult (same as all other doctor checks).
 *
 * @param phase2sDir    Path to ~/.phase2s (injectable for testing).
 * @param profilePaths  Paths to check for the source line (injectable for testing;
 *                      defaults to ~/.bash_profile and ~/.bashrc).
 */
export function checkBashPlugin(
  phase2sDir: string = join(homedir(), ".phase2s"),
  profilePaths: string[] = [
    join(homedir(), ".bash_profile"),
    join(homedir(), ".bashrc"),
  ],
): CheckResult {
  // Bash-only feature — non-Bash users (ZSH, fish, etc.) see an informational ✓.
  // Unlike checkShellPlugin, SHELL unset/empty means we cannot confirm Bash — skip.
  const shell = process.env.SHELL ?? "";
  const isBash = shell.endsWith("/bash");
  if (!isBash) {
    return {
      name: "Bash shell integration",
      ok: true,
      detail: `N/A (Bash-only — detected shell: ${shell || "unknown"})`,
    };
  }

  const pluginPath = join(phase2sDir, "phase2s-bash.sh");
  if (!existsSync(pluginPath)) {
    return {
      name: "Bash shell integration",
      ok: false,
      detail: "Bash plugin not installed",
      fix: "Run: phase2s setup --bash",
    };
  }

  // Write-permission check — mirrors checkShellPlugin: warns if future upgrades
  // will fail because ~/.phase2s is not writable.
  try {
    accessSync(phase2sDir, constants.W_OK);
  } catch {
    return {
      name: "Bash shell integration",
      ok: false,
      detail: `Plugin installed but ${phase2sDir} is not writable`,
      fix: `Run: chmod u+w "${phase2sDir}"  (needed for phase2s setup upgrades)`,
    };
  }

  // Check ~/.bash_profile or ~/.bashrc for a source line.
  // Accept both the $HOME-relative form and the absolute path form for
  // compatibility with users who sourced manually before setup --bash existed.
  // .some() is correct: sourced in either file is sufficient.
  const homeRelativePluginPath = "$HOME/.phase2s/phase2s-bash.sh";
  const sourced = profilePaths.some((f) => {
    try {
      const content = readFileSync(f, "utf-8");
      return content.includes(homeRelativePluginPath) || content.includes(pluginPath);
    } catch { return false; }
  });

  if (!sourced) {
    return {
      name: "Bash shell integration",
      ok: false,
      detail: "Bash plugin installed but not sourced in ~/.bash_profile or ~/.bashrc",
      fix: "Run: phase2s setup --bash  (adds the source line, idempotent)",
    };
  }

  return {
    name: "Bash shell integration",
    ok: true,
    detail: "Bash plugin installed and sourced",
  };
}

/**
 * Check session DAG integrity: every parentId must resolve to an existing session.
 * Read-only — reports dangling references, never modifies files.
 *
 * NOTE: This is a point-in-time snapshot. During concurrent session creation,
 * a partially-written session file may appear valid but reference a parent not yet
 * visible in the directory listing. False-positive dangling-parentId warnings are
 * possible but self-resolve on the next doctor run.
 *
 * @param sessionsDir  Path to the .phase2s/sessions/ directory (injectable for testing)
 */
export function checkSessionDag(sessionsDir: string): CheckResult {
  let files: string[];
  try {
    files = readdirSync(sessionsDir);
  } catch {
    // Sessions dir doesn't exist yet (fresh install) — nothing to check
    return { name: "Session DAG", ok: true, detail: "no sessions found" };
  }

  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/i;
  const sessionFiles = files.filter((f) => uuidPattern.test(f));

  if (sessionFiles.length === 0) {
    return { name: "Session DAG", ok: true, detail: "no sessions found" };
  }

  // Build id → parentId map
  const idSet = new Set<string>();
  const danglingRefs: Array<{ sessionId: string; parentId: string }> = [];

  const parsed: Array<{ id: string; parentId: string | null }> = [];
  for (const f of sessionFiles) {
    try {
      const raw = readFileSync(join(sessionsDir, f), "utf-8");
      const data = JSON.parse(raw) as Record<string, unknown>;
      if (
        data.schemaVersion === 2 &&
        data.meta &&
        typeof (data.meta as Record<string, unknown>).id === "string"
      ) {
        const meta = data.meta as { id: string; parentId?: unknown };
        idSet.add(meta.id);
        // Guard: parentId may be any JSON value in a crafted file; normalize to string | null
        const parentId = typeof meta.parentId === "string" ? meta.parentId : null;
        parsed.push({ id: meta.id, parentId });
      }
    } catch {
      /* skip corrupt files */
    }
  }

  for (const { id, parentId } of parsed) {
    if (parentId !== null && !idSet.has(parentId)) {
      danglingRefs.push({ sessionId: id, parentId });
    }
  }

  if (danglingRefs.length === 0) {
    return {
      name: "Session DAG",
      ok: true,
      detail: `${parsed.length} sessions, 0 dangling references`,
    };
  }

  const list = danglingRefs
    .map((r) => `${r.sessionId.slice(0, 8)}... → ${r.parentId.slice(0, 8)}... (not found)`)
    .join(", ");
  return {
    name: "Session DAG",
    ok: false,
    detail: `${danglingRefs.length} dangling parent ${danglingRefs.length === 1 ? "reference" : "references"}: ${list}`,
    fix: "These sessions are still usable. To clean up, delete them manually from .phase2s/sessions/",
  };
}

/**
 * Check that .phase2s/code-index.jsonl exists when ollamaBaseUrl is configured.
 *
 * - If ollamaBaseUrl is not configured: skip (N/A).
 * - If index is absent: warn — user should run 'phase2s sync'.
 * - If index is present but older than 24h: advisory warning (non-failing).
 * - If index is present and fresh: ok.
 */
export function checkCodeIndex(
  cwd: string = process.cwd(),
  config: Record<string, unknown> = {},
): CheckResult {
  const ollamaBaseUrl = config.ollamaBaseUrl as string | undefined;
  if (!ollamaBaseUrl) {
    return {
      name: "Code index",
      ok: true,
      detail: "N/A (ollamaBaseUrl not configured)",
    };
  }

  const indexPath = join(cwd, ".phase2s", "code-index.jsonl");
  if (!existsSync(indexPath)) {
    return {
      name: "Code index",
      ok: false,
      detail: "code-index.jsonl not found",
      fix: "Run 'phase2s sync' to build the semantic code index.",
    };
  }

  try {
    const { mtimeMs } = statSync(indexPath);
    const ageMs = Date.now() - mtimeMs;
    const oneDayMs = 24 * 60 * 60 * 1000;
    if (ageMs > oneDayMs) {
      const ageDays = Math.floor(ageMs / oneDayMs);
      return {
        name: "Code index",
        ok: true,
        detail: `code-index.jsonl is ${ageDays} day${ageDays === 1 ? "" : "s"} old (tip: run 'phase2s sync' to refresh)`,
      };
    }
  } catch {
    // stat failed — index exists but unreadable
  }

  return {
    name: "Code index",
    ok: true,
    detail: "code-index.jsonl present",
  };
}

/**
 * Tip: check whether AGENTS.md exists (project-level or user-global).
 *
 * Non-failing — AGENTS.md is optional. Returns ok:true regardless.
 * Prints a tip if neither file exists, so new users know about the feature.
 */
export function checkAgentsMd(
  cwd: string = process.cwd(),
  phase2sDir: string = join(homedir(), ".phase2s"),
): CheckResult {
  const projectPath = join(cwd, "AGENTS.md");
  const globalPath = join(phase2sDir, "AGENTS.md");

  const projectExists = existsSync(projectPath);
  const globalExists = existsSync(globalPath);

  if (projectExists && globalExists) {
    return {
      name: "AGENTS.md",
      ok: true,
      detail: "project + user-global found (both will be injected)",
    };
  }
  if (projectExists) {
    return { name: "AGENTS.md", ok: true, detail: `found at ${projectPath}` };
  }
  if (globalExists) {
    return { name: "AGENTS.md", ok: true, detail: `user-global found at ${globalPath}` };
  }
  return {
    name: "AGENTS.md",
    ok: true,
    detail: "not found (tip: create AGENTS.md in your project root to inject coding conventions into every session)",
  };
}

// ---------------------------------------------------------------------------
// runDoctor — entry point
// ---------------------------------------------------------------------------

/**
 * Implements `doctor --fix`: rebuild the session index and run the DAG integrity check.
 * Uses rebuildSessionIndexStrict so write failures propagate (unlike the silent best-effort
 * behavior of rebuildSessionIndex used in listSessions).
 */
async function runDoctorFix(): Promise<void> {
  const cwd = resolve(".");
  // Derive sessDir from cwd so the two are always consistent even if cwd changes.
  const sessDir = resolve(cwd, ".phase2s", "sessions");

  console.log(chalk.bold("\n  Phase2S doctor --fix\n"));
  process.stdout.write(chalk.dim("  Rebuilding session index...\n"));

  // Capture before count from the current on-disk index (null = no index yet → 0 entries).
  const existingIndex = await readSessionIndex(cwd);
  const beforeCount = Object.keys(existingIndex?.sessions ?? {}).length;

  let afterIndex;
  try {
    afterIndex = await rebuildSessionIndexStrict(cwd);
  } catch (err) {
    console.error(chalk.red(`  ✗  Rebuild failed: ${(err as Error).message}`));
    process.exit(1);
  }

  const afterCount = Object.keys(afterIndex.sessions).length;
  const recovered = afterCount - beforeCount;

  if (recovered > 0) {
    console.log(chalk.green(`  Recovered: ${recovered} session${recovered === 1 ? "" : "s"} (was ${beforeCount}, now ${afterCount})`));
  } else if (recovered < 0) {
    // Stale index entries removed (session files were deleted since last index write).
    console.log(chalk.yellow(`  Cleaned up: ${Math.abs(recovered)} stale entr${Math.abs(recovered) === 1 ? "y" : "ies"} (was ${beforeCount}, now ${afterCount})`));
  } else if (existingIndex === null && afterCount === 0) {
    // No index and no sessions — fresh install or wiped sessions dir.
    console.log(chalk.dim(`  Nothing to repair — no sessions found.`));
  } else {
    console.log(chalk.dim(`  Recovered: 0 sessions (index was current — ${afterCount} entries)`));
  }

  // Run DAG check on the repaired index.
  const dagResult = checkSessionDag(sessDir);
  if (dagResult.ok) {
    console.log(chalk.green(`  DAG check: OK (no dangling parentId references)`));
  } else {
    console.log(chalk.yellow(`  DAG check: warnings — ${dagResult.detail}`));
    if (dagResult.fix) {
      console.log(chalk.dim(`    ${dagResult.fix}`));
    }
    // Exit 1 on any DAG failure so scripts and CI can detect incomplete repairs.
    // Dangling parentIds self-resolve over time, but we still signal non-zero so
    // the caller knows the index is not fully clean.
    console.log("");
    process.exit(1);
  }

  console.log("");
}

/**
 * Phase2S installation health check entry point.
 *
 * @param opts.fix - When true, runs `doctor --fix`: rebuilds the session index from disk
 *   via rebuildSessionIndexStrict and runs the DAG integrity check. Exits 1 if the write
 *   fails (unlike the silent best-effort path used by listSessions). Returns immediately
 *   after the fix run — the normal health checks do not execute.
 */
export async function runDoctor(opts: { fix?: boolean } = {}): Promise<void> {
  // --fix mode: rebuild session index and run DAG check, then exit.
  if (opts.fix) {
    await runDoctorFix();
    return;
  }

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
    checkTemplatesDir(),
    checkShellPlugin(),
    checkBashPlugin(),
    checkTmux(),
    checkGitWorktree(),
    checkSessionDag(resolve(".phase2s", "sessions")),
    checkCodeIndex(resolve("."), existingConfig),
    checkAgentsMd(),
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
