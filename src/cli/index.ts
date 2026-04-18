import { Command } from "commander";
import { createInterface } from "node:readline";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { access, constants } from "node:fs/promises";
import { mkdirSync, writeFileSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import { execSync } from "node:child_process";
import { join, resolve, dirname } from "node:path";
import chalk from "chalk";
import { loadConfig, type Config } from "../core/config.js";
import { Agent } from "../core/agent.js";
import { disposeBrowser } from "../tools/browser.js";
import { Conversation } from "../core/conversation.js";
import { loadLearnings, formatLearningsForPrompt } from "../core/memory.js";
import { loadAllSkills } from "../skills/index.js";
import { substituteInputs, getUnfilledInputKeys, extractAskTokens, substituteAskValues, stripAskTokens } from "../skills/template.js";
import { log } from "../utils/logger.js";
import {
  migrateAll,
  saveSession as saveSessionV2,
  cloneSession,
  readReplState,
  writeReplState,
  type SessionMeta,
} from "../core/session.js";
import { loadAgents, formatAgentsList, type AgentDef } from "../core/agent-loader.js";
import { runConversationsBrowser } from "./conversations.js";
import { resolveReasoningModel, resolveAgentModel } from "./model-resolver.js";
import { handleColonCommand } from "./colon-commands.js";
import { buildCompactionSummary, buildCompactedMessages, getCompactBackupPath, shouldCompact } from "../core/compaction.js";
import { loadAgentsMd, formatAgentsMdBlock } from "../core/agents-md.js";

const _require = createRequire(import.meta.url);

// Walk up from the current file to find the package.json that owns this source.
// Works from src/cli/ (vitest / ts-node) and dist/src/cli/ (compiled runtime).
function findVersion(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    try {
      const pkg = _require(join(dir, "package.json")) as { name?: string; version?: string };
      if (pkg.name === "@scanton/phase2s" && pkg.version) return pkg.version;
    } catch { /* not here, keep walking up */ }
    dir = dirname(dir);
  }
  return "0.0.0";
}
const VERSION = findVersion();

/**
 * Directory for session auto-saves.
 * Evaluated lazily so that `-C /path` (process.chdir) is applied before the path is resolved.
 */
function sessionDir(): string {
  return join(process.cwd(), ".phase2s", "sessions");
}

/**
 * Find the most recently active session file via state.json.
 * Returns null if no active session is recorded or the file is missing.
 */
async function findLatestSession(): Promise<string | null> {
  const state = readReplState(process.cwd());
  if (!state?.currentSessionId) return null;
  const path = join(sessionDir(), `${state.currentSessionId}.json`);
  try {
    await access(path, constants.R_OK);
    return path;
  } catch {
    return null; // state.json pointed to a deleted/moved file
  }
}

export async function main(argv: string[] = process.argv): Promise<void> {
  // Best-effort browser cleanup on any exit (SIGTERM, uncaught errors, etc.)
  process.once("exit", () => { disposeBrowser().catch(() => {}); });

  const program = new Command();

  program
    .name("phase2s")
    .description("AI programming harness with multi-model support")
    .version(VERSION)
    .option("-p, --provider <provider>", "LLM provider (codex-cli | openai-api)")
    .option("-m, --model <model>", "Model to use")
    .option("--system <prompt>", "Custom system prompt")
    .option("--resume", "Resume the most recent session")
    .option("-s, --sandbox <name>", "Start session in an isolated git worktree named <name>")
    .option("-C, --cwd <path>", "Run as if started in <path> — useful for IDE integrations");

  // Apply -C before any subcommand runs.
  // process.chdir() here means all subsequent process.cwd() calls (including sessionDir())
  // resolve relative to the target directory.
  program.hook("preAction", () => {
    const opts = program.opts<{ cwd?: string }>();
    if (!opts.cwd) return;
    const target = resolve(opts.cwd);
    try {
      const stat = statSync(target);
      if (!stat.isDirectory()) {
        console.error(chalk.red(`phase2s: -C: not a directory: ${target}`));
        process.exit(1);
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        console.error(chalk.red(`phase2s: -C: no such directory: ${target}`));
      } else {
        console.error(chalk.red(`phase2s: -C: ${(err as NodeJS.ErrnoException).message}`));
      }
      process.exit(1);
    }
    process.chdir(target);
  });

  // Default command: interactive REPL
  program
    .command("chat", { isDefault: true })
    .description("Start an interactive chat session")
    .action(async () => {
      const opts = program.opts();
      const configOverrides = {
        provider: opts.provider,
        model: opts.model,
        systemPrompt: opts.system,
      };

      if (opts.sandbox) {
        const { startSandbox } = await import("./sandbox.js");
        await startSandbox(opts.sandbox, process.cwd(), configOverrides, !!opts.resume);
        await disposeBrowser().catch(() => {});
        process.exit(0);
        return;
      }

      const config = await loadConfig(configOverrides);
      await interactiveMode(config, { resume: !!opts.resume });
      // interactiveMode now returns instead of calling process.exit(0) directly.
      // Explicitly await disposeBrowser before exiting so Chromium doesn't become
      // a zombie — the process.once("exit") handler fires synchronously and cannot
      // await async cleanup.
      await disposeBrowser().catch(() => {});
      process.exit(0);
    });

  // One-shot mode
  program
    .command("run <prompt>")
    .description("Run a single prompt and exit")
    .option("--dry-run", "Show which skill and model would be used without executing")
    .action(async (prompt: string, cmdOpts: { dryRun?: boolean }) => {
      const opts = program.opts();
      const config = await loadConfig({
        provider: opts.provider,
        model: opts.model,
        systemPrompt: opts.system,
      });
      if (cmdOpts.dryRun) {
        const skills = await loadAllSkills();
        const { routedSkillName, unknownSkillName, modelOverride } = resolveSkillRouting(prompt, skills);
        if (routedSkillName) {
          const resolvedModel = modelOverride ?? config.model ?? "default";
          console.log(`Would route to skill: ${routedSkillName} (model: ${resolvedModel})`);
        } else if (unknownSkillName) {
          console.log(`No skill named '${unknownSkillName}'. Would run as plain prompt.`);
        } else {
          console.log(`Would run as plain prompt (no skill prefix detected).`);
        }
        return;
      }
      await oneShotMode(config, prompt);
    });

  // MCP server — exposes all Phase2S skills as Claude Code tools
  program
    .command("mcp")
    .description("Start Phase2S as an MCP server for Claude Code integration")
    .action(async () => {
      const { runMCPServer } = await import("../mcp/server.js");
      await runMCPServer(process.cwd());
    });

  // List available skills
  program
    .command("skills [query]")
    .description("List available skills, or filter with an optional search query")
    .option("--json", "Output as JSON")
    .action(async (query: string | undefined, cmdOpts: { json?: boolean }) => {
      let skills = await loadAllSkills();
      if (query) {
        const q = query.toLowerCase();
        skills = skills.filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            (s.description?.toLowerCase().includes(q) ?? false),
        );
      }
      if (cmdOpts.json) {
        const output = skills.map((s) => ({
          name: s.name,
          description: s.description ?? null,
          model: s.model ?? null,
          inputs: s.inputs
            ? Object.fromEntries(
                Object.entries(s.inputs).map(([k, v]) => [
                  k,
                  { prompt: v.prompt, type: v.type ?? "string", ...(v.enum ? { enum: v.enum } : {}) },
                ])
              )
            : null,
        }));
        console.log(JSON.stringify(output, null, 2));
        return;
      }
      if (skills.length === 0) {
        if (query) {
          console.log(chalk.yellow(`\n  No skills match "${query}". Try a broader term or run phase2s skills to list all.\n`));
        } else {
          log.info("No skills found. Add skills to .phase2s/skills/ or ~/.phase2s/skills/");
        }
        return;
      }
      const header = query
        ? chalk.bold(`\nSkills matching "${query}":\n`)
        : chalk.bold("\nAvailable skills:\n");
      console.log(header);
      for (const skill of skills) {
        const tierBadge =
          skill.model === "fast"
            ? chalk.blue(" [fast]")
            : skill.model === "smart"
              ? chalk.yellow(" [smart]")
              : "";
        console.log(`  ${chalk.cyan("/" + skill.name)}${tierBadge} — ${skill.description || "(no description)"}`);
      }
      console.log();
    });

  // Goal executor — dark factory mode
  program
    .command("goal <spec-file>")
    .description("Execute a spec file end-to-end: run sub-tasks, evaluate, retry until done")
    .option("--max-attempts <n>", "Maximum retry loops (default: 3)", "3")
    .option("--resume", "Resume from the last completed sub-task (reads state from .phase2s/state/)")
    .option("--review-before-run", "Run adversarial review on spec before executing")
    .option("--notify", "Send a notification when the run completes (macOS + optional Slack webhook)")
    .option("--dry-run", "Parse and display the spec decomposition tree without running anything")
    .option("--parallel", "Enable parallel execution of independent subtasks")
    .option("--sequential", "Force sequential execution (overrides auto-detect)")
    .option("--orchestrator", "Enable multi-agent orchestrator mode (role-aware, context-passing)")
    .option("--workers <n>", "Max concurrent workers per level (1-8, default 3)")
    .option("--dashboard", "Show live tmux dashboard during parallel execution")
    .option("--clean", "Remove stale worktrees before starting")
    .option("--judge", "Run spec eval judge after completion and emit eval_judged to the log")
    .action(async (specFile: string, cmdOpts: { maxAttempts?: string; resume?: boolean; reviewBeforeRun?: boolean; notify?: boolean; dryRun?: boolean; parallel?: boolean; sequential?: boolean; orchestrator?: boolean; workers?: string; dashboard?: boolean; clean?: boolean; judge?: boolean }) => {
      const { runGoal } = await import("./goal.js");
      try {
        const result = await runGoal(specFile, {
          maxAttempts: cmdOpts.maxAttempts,
          resume: cmdOpts.resume,
          reviewBeforeRun: cmdOpts.reviewBeforeRun,
          notify: cmdOpts.notify,
          dryRun: cmdOpts.dryRun,
          parallel: cmdOpts.parallel,
          sequential: cmdOpts.sequential,
          orchestrator: cmdOpts.orchestrator,
          workers: cmdOpts.workers ? parseInt(cmdOpts.workers, 10) : undefined,
          dashboard: cmdOpts.dashboard,
          clean: cmdOpts.clean,
          judge: cmdOpts.judge,
        });
        if (!result.dryRun && result.runLogPath) console.log(`Run log: ${result.runLogPath}`);
        process.exit(result.success ? 0 : 1);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Spec eval judge — standalone diff-aware coverage map
  program
    .command("judge <spec-file>")
    .description("Judge a spec run: compare acceptance criteria against a git diff and produce a coverage score")
    .option("--diff <file>", "Path to a diff file (alternatively pipe diff to stdin)")
    .action(async (specFile: string, cmdOpts: { diff?: string }) => {
      const { judgeRun, formatJudgeReport } = await import("../eval/judge.js");
      const { loadConfig } = await import("../core/config.js");
      const { basename } = await import("node:path");
      const { readFileSync } = await import("node:fs");

      let diff: string;
      if (cmdOpts.diff) {
        try {
          diff = readFileSync(cmdOpts.diff, "utf8");
        } catch (err) {
          console.error(`Error reading diff file: ${err instanceof Error ? err.message : String(err)}`);
          console.error("Usage: phase2s judge <spec.md> --diff <file>");
          process.exit(1);
        }
      } else if (!process.stdin.isTTY) {
        // Read from stdin
        diff = readFileSync("/dev/stdin", "utf8");
      } else {
        console.error("Error: provide a diff via --diff <file> or pipe to stdin");
        console.error("Usage: phase2s judge <spec.md> --diff <file>");
        console.error("       git diff HEAD~1 | phase2s judge <spec.md>");
        process.exit(1);
      }

      try {
        const config = await loadConfig();
        const result = await judgeRun(specFile, diff, config);
        console.log(formatJudgeReport(basename(specFile), result));
        // Exit 1 if score < 7 (or 0 if score >= 7 or score is null)
        if (result.score !== null && result.score < 7) process.exit(1);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Run log report viewer
  program
    .command("report <logfile>")
    .description("Display a human-readable summary of a dark factory run log (.jsonl)")
    .action(async (logfile: string) => {
      const { parseRunLog, buildRunReport, formatRunReport } = await import("./report.js");
      try {
        const events = parseRunLog(logfile);
        const report = buildRunReport(events);
        console.log(formatRunReport(report));
      } catch (err) {
        console.error(`Error reading run log: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  // Interactive setup wizard
  program
    .command("init")
    .description("Interactive setup wizard — configure .phase2s.yaml for your provider")
    .option("--non-interactive", "Skip prompts and use flag values (for CI)")
    .option("--provider <provider>", "Provider: codex-cli, openai-api, anthropic, ollama, openrouter, gemini")
    .option("--api-key <key>", "API key for openai-api or anthropic provider")
    .option("--openrouter-api-key <key>", "API key for openrouter provider")
    .option("--gemini-api-key <key>", "API key for gemini provider (starts with AIza)")
    .option("--fast-model <model>", "Fast tier model name")
    .option("--smart-model <model>", "Smart tier model name")
    .option("--slack-webhook <url>", "Slack webhook URL for notifications")
    .option("--discord-webhook <url>", "Discord webhook URL for notifications")
    .option("--teams-webhook <url>", "Microsoft Teams webhook URL for notifications")
    .option("--telegram-setup", "Run interactive Telegram bot setup wizard to find your chat ID")
    .action(async (cmdOpts: {
      nonInteractive?: boolean;
      provider?: string;
      apiKey?: string;
      openrouterApiKey?: string;
      geminiApiKey?: string;
      fastModel?: string;
      smartModel?: string;
      slackWebhook?: string;
      discordWebhook?: string;
      teamsWebhook?: string;
      telegramSetup?: boolean;
    }) => {
      const { runInit } = await import("./init.js");
      await runInit({
        nonInteractive: cmdOpts.nonInteractive,
        provider: cmdOpts.provider,
        apiKey: cmdOpts.apiKey,
        openrouterApiKey: cmdOpts.openrouterApiKey,
        geminiApiKey: cmdOpts.geminiApiKey,
        fastModel: cmdOpts.fastModel,
        smartModel: cmdOpts.smartModel,
        slackWebhook: cmdOpts.slackWebhook,
        discordWebhook: cmdOpts.discordWebhook,
        teamsWebhook: cmdOpts.teamsWebhook,
        telegramSetup: cmdOpts.telegramSetup,
      });
    });

  // Self-update command
  program
    .command("upgrade")
    .description("Check for a newer version and offer to install it")
    .option("--check", "Report whether an update is available without prompting")
    .action(async (cmdOpts: { check?: boolean }) => {
      const { runUpgrade } = await import("./upgrade.js");
      await runUpgrade(VERSION, { check: cmdOpts.check });
    });

  // Spec linting
  program
    .command("lint <spec-file>")
    .description("Validate a 5-pillar spec file before running it — catches structural errors before the dark factory run begins")
    .action(async (specFile: string) => {
      const { runLint } = await import("./lint.js");
      const ok = await runLint(specFile);
      if (!ok) process.exit(1);
    });

  // Session browser
  program
    .command("conversations")
    .description("Browse past sessions. Launches fzf if available, falls back to plain table.")
    .action(async () => {
      const selectedId = await runConversationsBrowser(process.cwd());
      if (selectedId) {
        // Resume the selected session by re-running interactiveMode with it active
        await writeReplState(process.cwd(), { currentSessionId: selectedId });
        const config = await loadConfig({});
        await interactiveMode(config, { resume: true });
        await disposeBrowser().catch(() => {});
        process.exit(0);
      }
    });

  // Installation health check
  program
    .command("doctor")
    .description("Check Phase2S installation health — Node version, auth, config, working dir")
    .option("--fix", "Rebuild session index and run DAG integrity check")
    .action(async (cmdOpts: { fix?: boolean }) => {
      const { runDoctor } = await import("./doctor.js");
      await runDoctor({ fix: !!cmdOpts.fix });
    });

  // Shell integration setup
  program
    .command("setup")
    .description("Install ZSH shell integration — enables ': <prompt>' from any directory")
    .option("--dry-run", "Show what would be done without writing any files")
    .action(async (cmdOpts: { dryRun?: boolean }) => {
      const { runSetup } = await import("./setup.js");
      await runSetup({ dryRun: cmdOpts.dryRun });
    });

  // Spec template library
  const templateCmd = program
    .command("template")
    .description("Manage spec templates");

  templateCmd
    .command("list")
    .description("List all bundled spec templates")
    .action(async () => {
      const { runTemplateList } = await import("./spec-template.js");
      runTemplateList();
    });

  templateCmd
    .command("use <name>")
    .description("Generate a spec from a template via interactive wizard")
    .action(async (name: string) => {
      const { runTemplateUse } = await import("./spec-template.js");
      await runTemplateUse(name, process.cwd());
    });

  // AI-generated commit messages
  program
    .command("commit")
    .description("Generate an AI commit message for staged changes")
    .option("--auto", "Commit immediately without confirmation (non-interactive, CI-safe)")
    .option("--preview", "Show proposed message only — do not commit")
    .action(async (cmdOpts: { auto?: boolean; preview?: boolean }) => {
      const opts = program.opts();
      const config = await loadConfig({ provider: opts.provider, model: opts.model });
      const { runCommitFlow } = await import("./commit.js");
      await runCommitFlow(config, { auto: cmdOpts.auto, preview: cmdOpts.preview });
    });

  // Sandbox listing command
  program
    .command("sandboxes")
    .description("List active sandbox worktrees for this repository")
    .action(async () => {
      const { listSandboxes } = await import("./sandbox.js");
      let sandboxes: import("./sandbox.js").SandboxEntry[];
      try {
        sandboxes = listSandboxes(process.cwd());
      } catch {
        console.error("Error: phase2s sandboxes requires a git repository.");
        process.exit(1);
      }

      if (sandboxes.length === 0) {
        console.log("(none)");
        return;
      }

      // Table output: SANDBOX / PATH / COMMIT
      // Column widths: max content width, minimum 16 / 40 / 7 chars respectively.
      // commitWidth = 7 matches the 7-char short hash produced by listSandboxes().
      const nameWidth = Math.max(16, ...sandboxes.map((s) => s.name.length));
      const pathWidth = Math.max(40, ...sandboxes.map((s) => s.path.length));
      const commitWidth = 7;

      const truncate = (s: string, w: number) =>
        s.length > w ? s.slice(0, w - 1) + "\u2026" : s;

      const pad = (s: string, w: number) => s.padEnd(w);

      console.log(
        `${pad("SANDBOX", nameWidth)}  ${pad("PATH", pathWidth)}  COMMIT`,
      );
      for (const s of sandboxes) {
        console.log(
          `${pad(truncate(s.name, nameWidth), nameWidth)}  ${pad(truncate(s.path, pathWidth), pathWidth)}  ${s.commit.slice(0, commitWidth)}`,
        );
      }
    });

  // Shell completion script generator
  program
    .command("completion <shell>")
    .description("Output shell completion script (bash | zsh). Source it to enable tab-completion.")
    .action(async (shell: string) => {
      switch (shell.toLowerCase()) {
        case "bash":
          process.stdout.write(BASH_COMPLETION);
          break;
        case "zsh":
          process.stdout.write(ZSH_COMPLETION);
          break;
        default:
          console.error(`Unsupported shell: ${shell}. Supported: bash, zsh`);
          process.exit(1);
      }
    });

  await program.parseAsync(argv);
}

// ---------------------------------------------------------------------------
// Shell completion scripts
// ---------------------------------------------------------------------------

const BASH_COMPLETION = `# phase2s bash completion
# Add to ~/.bashrc or ~/.bash_profile:
#   eval "$(phase2s completion bash)"

_phase2s_complete() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local prev="\${COMP_WORDS[COMP_CWORD-1]}"
  local subcmd="\${COMP_WORDS[1]}"

  # Complete subcommands at position 1
  if [[ \${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=($(compgen -W "chat run skills mcp goal judge report init upgrade lint doctor completion setup template" -- "\$cur"))
    return
  fi

  case "\$subcmd" in
    run)
      # Complete skill names when argument starts with /
      if [[ "\$cur" == /* ]]; then
        local skills
        skills=$(phase2s skills --json 2>/dev/null | grep -o '"name": "[^"]*"' | sed 's/"name": "\\(.*\\)"/\\/\\1/')
        COMPREPLY=($(compgen -W "\$skills" -- "\$cur"))
      fi
      ;;
    completion)
      COMPREPLY=($(compgen -W "bash zsh" -- "\$cur"))
      ;;
    skills)
      COMPREPLY=($(compgen -W "--json" -- "\$cur"))
      ;;
  esac
}

complete -F _phase2s_complete phase2s
`;

const ZSH_COMPLETION = `#compdef phase2s
# phase2s zsh completion
# Add to ~/.zshrc:
#   eval "$(phase2s completion zsh)"

_phase2s() {
  local -a subcommands
  subcommands=(
    'chat:Start an interactive REPL session'
    'run:Run a single prompt and exit'
    'skills:List available skills'
    'mcp:Start as an MCP server for Claude Code'
    'goal:Run a spec file autonomously (dark factory)'
    'report:Display a human-readable summary of a run log'
    'init:Interactive setup wizard — configure .phase2s.yaml'
    'upgrade:Check for a newer version and offer to install it'
    'lint:Validate a 5-pillar spec file before running it'
    'doctor:Check Phase2S installation health'
    'completion:Output shell completion script'
    'setup:Install ZSH shell integration'
    'template:Manage spec templates (list / use)'
  )

  if (( CURRENT == 2 )); then
    _describe 'subcommand' subcommands
    return
  fi

  case "\${words[2]}" in
    run)
      # Complete skill names when argument starts with /
      if [[ "\${words[CURRENT]}" == /* ]]; then
        local -a skills
        skills=(\${(f)"\$(phase2s skills --json 2>/dev/null | grep -o '"'"'\"name\": \"[^\"]*\"'"'"' | sed 's/\"name\": \"\\(.*\\)\"/\\/\\1/')"})
        compadd -a skills
      fi
      ;;
    completion)
      local -a shells
      shells=('bash:Bash completion script' 'zsh:Zsh completion script')
      _describe 'shell' shells
      ;;
    skills)
      _arguments '--json[Output as JSON]'
      ;;
  esac
}

_phase2s
`;

const UNDERSPEC_WORD_THRESHOLD = 15;

function isUnderspecified(prompt: string): boolean {
  const words = prompt.trim().split(/\s+/).filter(Boolean);
  const hasFilePath = /[./]/.test(prompt);
  return words.length < UNDERSPEC_WORD_THRESHOLD && !hasFilePath;
}

function makeSlug(prompt: string): string {
  return prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 40);
}

async function writeContextSnapshot(prompt: string, config: Config): Promise<void> {
  const dir = resolve(".phase2s", "context");
  await mkdir(dir, { recursive: true });
  const slug = makeSlug(prompt);
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
  const filename = `${ts}-${slug}.md`;
  const filePath = resolve(dir, filename);

  let gitLog = "";
  let gitDiff = "";
  let branch = "unknown";
  try {
    branch = execSync("git branch --show-current", { encoding: "utf-8" }).trim();
    gitLog = execSync("git log --oneline -5", { encoding: "utf-8" }).trim();
    gitDiff = execSync("git diff --stat HEAD", { encoding: "utf-8" }).trim();
  } catch {
    // Not a git repo or git not available
  }

  const content = [
    `# Context Snapshot: ${slug}`,
    `Date: ${new Date().toISOString()}`,
    `Branch: ${branch}`,
    `Task: ${prompt.slice(0, 200)}`,
    "",
    "## Codebase Context",
    gitLog || "(no git log)",
    "",
    gitDiff || "(no uncommitted changes)",
    "",
    "## Success Criteria",
    `Passes: ${config.verifyCommand ?? "npm test"}`,
    "",
    "## Unknowns",
    "[to be filled by agent during first pass]",
  ].join("\n");

  await writeFile(filePath, content, "utf-8");
  log.dim(`Context snapshot: .phase2s/context/${filename}`);
}

async function writeSatoriLog(
  slug: string,
  startedAt: string,
  result: import("../core/agent.js").SatoriResult,
  config: Config,
  allAttempts: import("../core/agent.js").SatoriResult[],
): Promise<void> {
  const dir = resolve(".phase2s", "satori");
  await mkdir(dir, { recursive: true });
  const filePath = resolve(dir, `${slug}.json`);

  const log_data = {
    taskSlug: slug,
    startedAt,
    completedAt: new Date().toISOString(),
    maxRetries: allAttempts.length,
    verifyCommand: config.verifyCommand ?? "npm test",
    attempts: allAttempts.map((a) => ({
      attempt: a.attempt,
      passed: a.passed,
      exitCode: a.passed ? 0 : 1,
      failureLines: a.verifyOutput
        .split("\n")
        .filter((l) => /fail|error|assert/i.test(l))
        .slice(0, 5),
    })),
    finalStatus: result.passed ? "passed" : "failed",
  };

  await writeFile(filePath, JSON.stringify(log_data, null, 2), "utf-8");
}

/**
 * Interactive REPL.
 *
 * Uses a manual event-queue pattern (rl.on('line')) rather than the
 * readline async iterator. The async iterator has a known issue where
 * it terminates if the event loop drains while awaiting between turns —
 * which is exactly what happens while the LLM is streaming.
 */
export async function interactiveMode(config: Config, opts: { resume?: boolean } = {}): Promise<void> {
  if (!(await checkCodexBinary(config))) process.exit(1);
  if (!checkOpenAIKey(config)) process.exit(1);
  if (!checkAnthropicKey(config)) process.exit(1);

  // Migrate legacy sessions on first run after upgrade (one-time, resumable)
  await migrateAll(process.cwd());

  // Determine the active session UUID and path
  const { randomUUID } = await import("node:crypto");
  let sessionId: string;
  let resumedConversation: Conversation | undefined;
  let sessionMeta: SessionMeta;
  let loadedResumeMeta: SessionMeta | undefined;

  if (opts.resume) {
    const latestPath = await findLatestSession();
    if (latestPath) {
      try {
        resumedConversation = await Conversation.load(latestPath);
        const state = readReplState(process.cwd());
        sessionId = state?.currentSessionId ?? randomUUID();
        // Preserve DAG metadata (parentId, branchName, createdAt) from the resumed file.
        // Without this, sessionMeta is always re-initialized with parentId:null which
        // destroys the clone lineage on the first save after --resume.
        try {
          const raw = JSON.parse(readFileSync(latestPath, "utf-8"));
          // Validate required fields before trusting the on-disk shape.
          // An empty object or partial meta would silently corrupt sessionMeta.id/createdAt.
          if (
            raw?.schemaVersion === 2 &&
            raw.meta &&
            typeof raw.meta.id === "string" &&
            typeof raw.meta.branchName === "string" &&
            typeof raw.meta.createdAt === "string"
          ) {
            loadedResumeMeta = raw.meta as SessionMeta;
          }
        } catch { /* fall through to defaults below */ }
        console.log(chalk.dim(`Resuming session (${resumedConversation.length} messages)\n`));
      } catch {
        console.log(chalk.yellow("Warning: Could not load previous session. Starting fresh.\n"));
        sessionId = randomUUID();
      }
    } else {
      console.log(chalk.yellow("No previous session found. Starting fresh.\n"));
      sessionId = randomUUID();
    }
  } else {
    sessionId = randomUUID();
  }

  const now = new Date().toISOString();
  if (loadedResumeMeta) {
    // Restore the full DAG metadata from the resumed session, updating only updatedAt.
    sessionMeta = { ...loadedResumeMeta, updatedAt: now };
  } else {
    sessionMeta = {
      id: sessionId,
      parentId: null,
      branchName: "main",
      createdAt: now,
      updatedAt: now,
    };
  }

  // Record this as the active session
  await writeReplState(process.cwd(), { currentSessionId: sessionId });

  // activeSessionPath and sessionMeta are mutable — :clone updates both
  let activeSessionPath = join(sessionDir(), `${sessionId}.json`);

  console.log(chalk.bold(`\nPhase2S v${VERSION}`));
  console.log(chalk.dim("Type your message and press Enter. Type /quit to exit.\n"));

  // Load persistent memory learnings from .phase2s/memory/learnings.jsonl
  const learningsList = await loadLearnings(process.cwd());
  const learningsStr = formatLearningsForPrompt(learningsList);
  if (learningsList.length > 0) {
    log.dim(`Learnings: ${learningsList.length} ${learningsList.length === 1 ? "entry" : "entries"} from .phase2s/memory/`);
  }

  // Load named agent definitions (built-ins + project overrides)
  const agentDefs = await loadAgents(process.cwd());

  // Resolve which agent to activate at startup.
  // On --resume, restore the saved activeAgentId from state.json (if present + still valid).
  let activeAgentId: string | undefined;
  // Track the active AgentDef to apply its model tier to normal REPL turns.
  let activeAgentDef: AgentDef | undefined;
  if (opts.resume) {
    const state = readReplState(process.cwd());
    const savedId = state?.activeAgentId;
    if (savedId) {
      if (agentDefs.has(savedId)) {
        activeAgentId = savedId;
      } else {
        console.log(chalk.yellow(`Warning: saved agent '${savedId}' no longer exists — reverting to default (ares)\n`));
      }
    }
  }

  // Load AGENTS.md (user-global + project-level) and inject into system prompt
  const agentsMdContent = await loadAgentsMd(process.cwd());
  if (agentsMdContent) {
    log.dim(`AGENTS.md loaded (${agentsMdContent.length} chars)`);
  }
  const agentsMdBlock = agentsMdContent ? formatAgentsMdBlock(agentsMdContent) : undefined;

  // Pass agentsMdBlock separately from config.systemPrompt so the Agent can re-inject
  // it after switchAgentDef() (persona switches) without carrying over the old persona.
  const agent = new Agent({ config, conversation: resumedConversation, learnings: learningsStr, systemPrompt: config.systemPrompt, agentsMdBlock });
  // AbortController for cooperative SIGINT cancellation.
  // Aborted in the SIGINT handler; signal is passed to every agent.run() call so the
  // in-flight Codex/provider request is cancelled rather than waiting to finish.
  const sigintController = new AbortController();

  // Apply restored agent persona if resuming with one active
  if (activeAgentId) {
    const def = agentDefs.get(activeAgentId)!;
    agent.switchAgentDef(def);
    activeAgentDef = def;
    console.log(chalk.cyan(`→ Resumed as: ${def.id} (${def.title})\n`));
  }

  const skills = await loadAllSkills();

  /**
   * In-memory reasoning tier override. Controlled by :re [high|low|default].
   * Applies only to normal REPL turns — skill invocations use their own skill.model.
   * Never written to disk (session-scoped only).
   */
  let reasoningOverride: "high" | "low" | undefined;

  // Ensure stdin is open and stays open for the full session
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  // Manual async queue: lines go in via rl.on('line'), come out via nextLine()
  const lineQueue: string[] = [];
  let pendingResolve: ((line: string | null) => void) | null = null;
  let isOpen = true;

  rl.on("line", (line) => {
    if (pendingResolve) {
      const resolve = pendingResolve;
      pendingResolve = null;
      resolve(line);
    } else {
      lineQueue.push(line);
    }
  });

  rl.on("close", () => {
    isOpen = false;
    if (pendingResolve) {
      pendingResolve(null);
      pendingResolve = null;
    }
  });

  rl.on("SIGINT", () => {
    process.stdout.write("\n");
    // Atomic synchronous save before exit — async operations can't complete after process.exit().
    // tmp → rename ensures the session file is never left partially written.
    // mkdirSync is inside the try so any EACCES/EROFS propagates to the catch instead of
    // crashing the SIGINT handler with an unhandled exception.
    const tmp = activeSessionPath + ".tmp." + process.pid;
    try {
      mkdirSync(resolve(activeSessionPath, ".."), { recursive: true });
      writeFileSync(
        tmp,
        JSON.stringify({
          schemaVersion: 2,
          meta: { ...sessionMeta, updatedAt: new Date().toISOString() },
          messages: agent.getConversation().getMessages(),
        }, null, 2),
        { encoding: "utf-8", mode: 0o600 },
      );
      renameSync(tmp, activeSessionPath);
    } catch {
      // Clean up the tmp file if write succeeded but rename failed (or if write itself failed)
      try { rmSync(tmp, { force: true }); } catch { /* ignore */ }
      process.stderr.write("Warning: session save failed on exit — last turn may not be saved.\n");
    }
    log.info("Goodbye!");
    // Abort any in-flight agent.run() call so the provider cancels its HTTP request
    // or spawned process. The signal is already wired into chatStream() for all providers.
    sigintController.abort();
    rl.close();
    // Don't call process.exit(0) here — let interactiveMode return so callers
    // (e.g. sandbox.ts try/finally) can run their cleanup before exit.
  });

  /** Wait for the next line of input. Returns null if stdin closes. */
  const nextLine = (): Promise<string | null> => {
    if (lineQueue.length > 0) return Promise.resolve(lineQueue.shift()!);
    if (!isOpen) return Promise.resolve(null);
    return new Promise((resolve) => {
      pendingResolve = resolve;
    });
  };

  /** Save the current conversation to the active session file (best-effort, v2 format). */
  const saveSession = async (): Promise<void> => {
    try {
      await saveSessionV2(process.cwd(), activeSessionPath, agent.getConversation(), sessionMeta);
    } catch {
      // Best-effort — session save failures don't interrupt the user
    }
  };

  const writePrompt = () => process.stdout.write(chalk.green("you > "));

  /**
   * Compact the current session by replacing the conversation history with an
   * LLM-generated summary. Writes a backup file before destructive replacement.
   *
   * On success: prints a notice, updates sessionMeta.compact_count, saves session.
   * On failure: prints a warning, leaves session unchanged.
   */
  const performCompaction = async (): Promise<void> => {
    const messages = agent.getConversation().getMessages();
    const tokenEstimate = agent.getConversation().estimateTokens();
    process.stdout.write(chalk.cyan(`↻ Compacting session (${Math.round(tokenEstimate / 1000)}k tokens)...`));

    // Write backup before any destructive operation.
    // If the backup fails, abort — it is unsafe to destroy history without a recovery file.
    // Stamp with the next compact_count so repeated compactions don't overwrite earlier backups.
    const nextCompactCount = (sessionMeta.compact_count ?? 0) + 1;
    const backupPath = getCompactBackupPath(activeSessionPath, nextCompactCount);
    try {
      await writeFile(
        backupPath,
        JSON.stringify({ schemaVersion: 2, meta: sessionMeta, messages }, null, 2),
        { encoding: "utf-8", mode: 0o600 },
      );
    } catch (err) {
      process.stdout.write("\n");
      console.warn(chalk.yellow(`⚠  Compaction aborted — could not write backup: ${err instanceof Error ? err.message : String(err)}`));
      return;
    }

    let summary: string;
    try {
      summary = await buildCompactionSummary(agent.provider, messages);
    } catch (err) {
      process.stdout.write("\n");
      console.warn(chalk.yellow(`⚠  Compaction failed: ${err instanceof Error ? err.message : String(err)}`));
      return;
    }

    if (!summary.trim()) {
      process.stdout.write("\n");
      console.warn(chalk.yellow("⚠  Compaction returned empty summary — session not compacted."));
      return;
    }

    agent.setConversation(Conversation.fromMessages(buildCompactedMessages(summary)));

    // Increment compact_count in sessionMeta (persisted on next saveSession)
    sessionMeta = {
      ...sessionMeta,
      compact_count: nextCompactCount,
      updatedAt: new Date().toISOString(),
    };

    process.stdout.write(" done.\n");
    justCompacted = true;

    // Explicit error handling here (unlike the best-effort saveSession() used elsewhere):
    // if persistence fails after compaction, the user's history is gone in memory only —
    // warn them so they know the compact won't survive a restart.
    try {
      await saveSessionV2(process.cwd(), activeSessionPath, agent.getConversation(), sessionMeta);
    } catch {
      console.warn(chalk.yellow("⚠  Compact applied in memory, but session save failed — compaction will be lost on restart."));
    }
  };

  // Guards against an auto-compact loop: if the LLM produces a summary that
  // itself exceeds the threshold, the very next turn would fire compaction
  // again before the user does anything. Reset to false after each normal turn.
  let justCompacted = false;

  /**
   * Check if auto-compaction should fire and run it if so.
   * Called PRE-TURN — before agent.run() — so the LLM processes the turn
   * with a fresh context after compaction.
   *
   * Skips one turn immediately after a compaction to prevent an infinite loop
   * where a verbose summary itself exceeds the threshold.
   */
  const maybeAutoCompact = async (): Promise<void> => {
    if (justCompacted) {
      justCompacted = false;
      return;
    }
    const tokens = agent.getConversation().estimateTokens();
    if (shouldCompact(tokens, config.auto_compact_tokens)) {
      await performCompaction();
    }
  };

  // Main REPL loop
  while (true) {
    writePrompt();

    const line = await nextLine();
    if (line === null) break; // stdin closed cleanly

    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed === "/quit" || trimmed === "/exit") {
      log.info("Goodbye!");
      rl.close();
      break;
      // Don't call process.exit(0) here — let interactiveMode return so callers
      // (e.g. sandbox.ts try/finally) can run their cleanup before exit.
    }

    if (trimmed === "/help") {
      printHelp(skills);
      continue;
    }

    // Dispatch stateless colon commands via pure handler (see src/cli/colon-commands.ts).
    // :clone and :commit are handled below — they require nextLine() from this scope.
    {
      const action = handleColonCommand(trimmed, { agentDefs });
      switch (action.type) {
        case "not_handled":
          break; // fall through to :clone/:commit/:skill/normal-turn handling

        case "show_reasoning": {
          const tier = reasoningOverride ?? "default";
          const model = resolveReasoningModel(reasoningOverride, config) ?? config.model ?? "default";
          const overrideSuffix = reasoningOverride ? chalk.dim(" [overridden — use :re default to reset]") : "";
          console.log(chalk.cyan(`→ Reasoning: ${tier} (${model})${overrideSuffix}`));
          continue;
        }

        case "set_reasoning": {
          reasoningOverride = action.tier;
          const resolvedModel = resolveReasoningModel(action.tier, config);
          const model = resolvedModel ?? config.model ?? "default";
          if (action.tier && resolvedModel === undefined) {
            const tierModel = action.tier === "high" ? "smart_model" : "fast_model";
            console.log(chalk.yellow(`⚠  ${tierModel} not configured — using default model (${model})`));
          }
          console.log(chalk.cyan(`→ Reasoning: ${action.tier ?? "default"} (${model})`));
          continue;
        }

        case "list_agents":
          console.log(chalk.bold("\n" + formatAgentsList(agentDefs) + "\n"));
          continue;

        case "switch_agent": {
          agent.switchAgentDef(action.agentDef);
          activeAgentId = action.agentId;
          activeAgentDef = action.agentDef;
          // Persist the active agent so --resume restores it
          const state = readReplState(process.cwd());
          await writeReplState(process.cwd(), {
            currentSessionId: state?.currentSessionId ?? sessionId,
            activeAgentId: action.agentId,
          });
          console.log(chalk.cyan(`→ Switched to: ${action.agentId} (${action.agentDef.title})\n`));
          continue;
        }

        case "unknown_agent":
          console.log(chalk.yellow(`Agent '${action.requestedId}' not found.`));
          console.log(chalk.dim("Try :agents to list available agents."));
          continue;

        case "unknown_command":
          console.log(chalk.yellow(`Unknown command: ${action.command}`));
          console.log(chalk.dim("Try /help for available commands and :agents for agent list."));
          continue;

        case "error":
          console.log(chalk.red(action.message));
          continue;

        default: {
          // TypeScript exhaustiveness guard — if a new ColonAction variant is
          // added to colon-commands.ts and not handled here, this becomes a
          // compile error instead of a silent fall-through to agent.run().
          const _never: never = action;
          void _never;
          continue;
        }
      }
    }

    // :clone <uuid> — fork the specified session into a new one
    if (trimmed.startsWith(":clone")) {
      const sourceId = trimmed.slice(":clone".length).trim();
      if (!sourceId) {
        console.log(chalk.yellow("Usage: :clone <session-uuid>"));
        console.log(chalk.dim("Get a UUID from: phase2s conversations"));
        continue;
      }
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!UUID_RE.test(sourceId)) {
        console.log(chalk.red("Invalid session ID: must be a UUID (get one from: phase2s conversations)"));
        continue;
      }
      process.stdout.write(chalk.cyan("Branch name (press Enter for default): "));
      const branchInput = await nextLine();
      const branchName = branchInput?.trim() || undefined;
      try {
        const result = await cloneSession(process.cwd(), sourceId, branchName);
        // Switch the active session to the new clone.
        // Use timestamps from cloneSession() — they match what was written to disk.
        // Calling new Date() here would drift from the on-disk createdAt.
        sessionMeta = {
          id: result.id,
          parentId: sourceId,
          branchName: result.branchName,
          createdAt: result.createdAt,
          updatedAt: result.updatedAt,
        };
        activeSessionPath = result.path;
        await writeReplState(process.cwd(), { currentSessionId: result.id });
        // Load the cloned session into the agent, preserving the current system prompt.
        // Without this, the agent continues from its in-memory conversation which diverges
        // from the clone file on the next :clone or --resume.
        const clonedConv = await Conversation.load(result.path);
        agent.setConversation(clonedConv);
        console.log(chalk.green(`Cloned ${sourceId.slice(0, 8)}... → ${result.id.slice(0, 8)}... (${result.messageCount} messages inherited)`));
        console.log(chalk.dim(`Branch: ${result.branchName}`));
      } catch (err) {
        log.error(err instanceof Error ? err.message : String(err));
      }
      continue;
    }

    // :compact — immediately compact the conversation history
    if (trimmed === ":compact") {
      await performCompaction();
      continue;
    }

    // :commit — generate an AI commit message for staged changes from inside the REPL
    if (trimmed === ":commit" || trimmed.startsWith(":commit ")) {
      const { buildCommitMessage, runCommitFlow, runGitCommit, SecretWarningError } = await import("./commit.js");
      const { createRl: makeRl, ask: askUser } = await import("./prompt-util.js");
      let secretsSendAnyway = false;
      let result: Awaited<ReturnType<typeof buildCommitMessage>> | undefined;
      // Loop to handle secret warnings interactively (same pattern as runCommitFlow)
      while (true) {
        try {
          // buildCommitMessage() creates its own ephemeral Agent — the REPL conversation is never touched.
          result = await buildCommitMessage(config, { secretsSendAnyway });
          break;
        } catch (err: unknown) {
          if (err instanceof SecretWarningError) {
            console.log(chalk.yellow(`\n⚠  ${err.message}`));
            const rl3 = makeRl();
            try {
              const answer = await askUser(rl3, "  [s]end anyway / [c]ancel: ");
              if (answer.toLowerCase().startsWith("s")) {
                secretsSendAnyway = true;
                continue;
              }
            } finally {
              rl3.close();
            }
            console.log(chalk.dim("Commit cancelled."));
          } else {
            console.log(chalk.red(`✗ ${(err as Error).message}`));
          }
          break;
        }
      }
      if (result === undefined || result === null) {
        if (result === null) {
          console.log(chalk.yellow("Model returned no message. Try again or commit manually with git commit."));
        }
        continue;
      }
      console.log(chalk.bold("\nProposed commit message:"));
      console.log(chalk.cyan(`  ${result.message}`));
      console.log(chalk.dim(`\nStaged changes:\n${result.diffStat}`));
      console.log();
      // Show accept/edit/cancel prompt. Accept uses the already-generated message.
      // Edit delegates to runCommitFlow() which will rebuild the message (one extra LLM call,
      // acceptable on an uncommon branch).
      const rl2 = makeRl();
      try {
        const answer = await askUser(rl2, "[a]ccept / [e]dit / [c]ancel: ");
        const key = answer.toLowerCase().trim();
        if (key.startsWith("a") || key === "") {
          const { ok, output } = runGitCommit(result.message);
          if (ok) {
            console.log(chalk.green(`✓ Committed: ${result.message}`));
            if (output) console.log(chalk.dim(output));
          } else {
            console.log(chalk.red("✗ Commit failed:"));
            if (output) console.log(output);
          }
        } else if (key.startsWith("e")) {
          console.log(chalk.dim("Opening editor..."));
          await runCommitFlow(config, {});
        } else {
          console.log(chalk.dim("Commit cancelled."));
        }
      } finally {
        rl2.close();
      }
      continue;
    }

    // Skill invocation — batch mode (no streaming, keeps the "Running..." indicator)
    if (trimmed.startsWith("/")) {
      const skillName = trimmed.slice(1).split(" ")[0];
      const skill = skills.find((s) => s.name === skillName);
      if (skill) {
        const args = trimmed.slice(1 + skillName.length).trim();
        const expanded = skill.promptTemplate + buildSkillContext(args);

        // Underspecification gate
        if (config.requireSpecification && !args.startsWith("force:")) {
          const checkPrompt = args || trimmed;
          if (isUnderspecified(checkPrompt)) {
            console.log(chalk.yellow("⚠  This prompt seems underspecified. Add more detail, or prefix with 'force:' to proceed."));
            continue;
          }
        }

        const safeArgs = args.startsWith("force:") ? args.slice("force:".length).trim() : args;

        // Prompt user for any declared inputs that appear as {{key}} in the template
        const inputValues: Record<string, string> = {};
        const unfilledKeys = getUnfilledInputKeys(skill.promptTemplate, skill.inputs);
        for (const key of unfilledKeys) {
          const inputDef = skill.inputs![key];
          const typeHint =
            inputDef.type === "boolean"
              ? " (yes/no)"
              : inputDef.type === "enum" && inputDef.enum?.length
                ? ` [${inputDef.enum.join("/")}]`
                : "";
          process.stdout.write(chalk.cyan(`  ${inputDef.prompt}${typeHint} `));
          const answer = await nextLine();
          inputValues[key] = answer?.trim() ?? "";
        }
        let substitutedTemplate = substituteInputs(skill.promptTemplate, inputValues, skill.inputs);

        // Resolve {{ASK:}} tokens — inline questions embedded in the template body.
        // Only in interactive (TTY) mode. Non-TTY stdin (piped/redirected) falls through
        // to the same strip+warn path as one-shot mode.
        const askTokens = extractAskTokens(substitutedTemplate);
        if (askTokens.length > 0) {
          if (process.stdin.isTTY) {
            const answers = new Map<string, string>();
            for (const token of askTokens) {
              process.stdout.write(chalk.cyan(`  ${token.prompt} `));
              const answer = await nextLine();
              answers.set(token.prompt, answer?.trim() ?? "");
            }
            substitutedTemplate = substituteAskValues(substitutedTemplate, answers);
          } else {
            // Non-interactive stdin — strip tokens and warn so the user knows
            const { result } = stripAskTokens(substitutedTemplate);
            substitutedTemplate = result;
            process.stderr.write(
              `[phase2s] Skill '${skill.name}' has interactive {{ASK:}} prompts that were skipped (non-TTY stdin). Run interactively for full behaviour.\n`,
            );
          }
        }

        const finalExpanded = substitutedTemplate + buildSkillContext(safeArgs);

        process.stdout.write(chalk.dim(`Running /${skill.name}${safeArgs ? ` on: ${safeArgs}` : ""}...\n`));

        // Satori mode: skill declares retries > 0
        if (skill.retries && skill.retries > 0) {
          await maybeAutoCompact();
          const slug = makeSlug(finalExpanded.slice(0, 100));
          const startedAt = new Date().toISOString();
          const attempts: import("../core/agent.js").SatoriResult[] = [];

          try {
            const response = await agent.run(finalExpanded, {
              modelOverride: skill.model,
              maxRetries: skill.retries,
              verifyCommand: config.verifyCommand,
              signal: sigintController.signal,
              preRun: () => writeContextSnapshot(finalExpanded, config),
              postRun: async (result) => {
                attempts.push(result);
                await writeSatoriLog(slug, startedAt, result, config, attempts);
              },
            });
            console.log(chalk.bold("\nassistant > ") + response + "\n");
            await saveSession();
          } catch (err) {
            log.error(err instanceof Error ? err.message : String(err));
          }
        } else {
          // Normal skill run
          await maybeAutoCompact();
          try {
            const response = await agent.run(finalExpanded, { modelOverride: skill.model, signal: sigintController.signal });
            console.log(chalk.bold("\nassistant > ") + response + "\n");
            await saveSession();
          } catch (err) {
            log.error(err instanceof Error ? err.message : String(err));
          }
        }
        continue;
      }
    }

    // Normal message — stream deltas as they arrive
    // Model priority: :re override > active agent's model tier > config.model
    // :re is user-explicit and always wins; agent model is applied when no :re override is set.
    const normalTurnModel =
      resolveReasoningModel(reasoningOverride, config) ??
      (activeAgentDef ? resolveAgentModel(activeAgentDef.model, config) : undefined);
    await maybeAutoCompact();
    process.stdout.write(chalk.bold("\nassistant > "));
    try {
      await agent.run(trimmed, { onDelta: (chunk) => process.stdout.write(chunk), modelOverride: normalTurnModel, signal: sigintController.signal });
      process.stdout.write("\n\n");
      await saveSession();
    } catch (err) {
      process.stdout.write("\n");
      log.error(err instanceof Error ? err.message : String(err));
    }
  }
}

/**
 * Check that the configured codex binary is executable before starting.
 * Prints a clear, actionable error message if not found — rather than letting
 * the user hit a cryptic ENOENT from spawn() mid-session.
 */
async function checkCodexBinary(config: Config): Promise<boolean> {
  if (config.provider !== "codex-cli") return true;

  const codexPath = config.codexPath;

  // If it looks like an absolute/relative path, check directly
  if (codexPath.startsWith("/") || codexPath.startsWith(".")) {
    try {
      await access(resolve(codexPath), constants.X_OK);
      return true;
    } catch {
      // fall through to error
    }
  } else {
    // Search PATH entries
    const pathDirs = (process.env.PATH ?? "").split(":");
    for (const dir of pathDirs) {
      try {
        await access(resolve(dir, codexPath), constants.X_OK);
        return true;
      } catch {
        // not in this dir
      }
    }
  }

  console.error(
    chalk.red(`\n✗ "${codexPath}" not found or not executable.\n`) +
    chalk.dim(
      "  Install Codex CLI:  npm install -g @openai/codex\n" +
      "  Or switch provider: PHASE2S_PROVIDER=openai-api phase2s\n" +
      "  Or set path:        PHASE2S_CODEX_PATH=/path/to/codex phase2s\n",
    ),
  );
  return false;
}

/**
 * Pre-flight check for the openai-api provider: verify API key is set
 * before opening the REPL, so the user gets a clear error at startup
 * rather than mid-session.
 */
function checkOpenAIKey(config: Config): boolean {
  if (config.provider !== "openai-api") return true;
  if (config.apiKey) return true;

  console.error(
    chalk.red("\n✗ OpenAI API key not found.\n") +
    chalk.dim(
      "  Set it:  export OPENAI_API_KEY=sk-...\n" +
      "  Or add:  apiKey: sk-... in .phase2s.yaml\n",
    ),
  );
  return false;
}

function checkAnthropicKey(config: Config): boolean {
  if (config.provider !== "anthropic") return true;
  if (config.anthropicApiKey) return true;

  console.error(
    chalk.red("\n✗ Anthropic API key not found.\n") +
    chalk.dim(
      "  Set it:  export ANTHROPIC_API_KEY=sk-ant-...\n" +
      "  Or add:  anthropicApiKey: sk-ant-... in .phase2s.yaml\n",
    ),
  );
  return false;
}

/**
 * Resolve a one-shot prompt against a skill list.
 *
 * If `prompt` starts with "/" and the skill name matches, returns the expanded
 * prompt (template + context) and model override. Otherwise returns the prompt
 * unchanged with no model override.
 *
 * Exported for unit testing — not part of the public API.
 */
export function resolveSkillRouting(
  prompt: string,
  skills: import("../skills/types.js").Skill[],
): { effectivePrompt: string; modelOverride: string | undefined; routedSkillName: string | null; unknownSkillName: string | null } {
  if (!prompt.startsWith("/")) {
    return { effectivePrompt: prompt, modelOverride: undefined, routedSkillName: null, unknownSkillName: null };
  }

  const rest = prompt.slice(1);
  const [skillName, ...argParts] = rest.split(" ");
  const args = argParts.join(" ");

  if (!skillName) {
    return { effectivePrompt: prompt, modelOverride: undefined, routedSkillName: null, unknownSkillName: null };
  }

  const skill = skills.find((s) => s.name === skillName);
  if (skill) {
    let substitutedTemplate = substituteInputs(skill.promptTemplate, {}, skill.inputs);
    // Strip {{ASK:}} tokens — one-shot mode is non-interactive.
    const { result: stripped, stripped: hadAskTokens } = stripAskTokens(substitutedTemplate);
    if (hadAskTokens) {
      process.stderr.write(
        `[phase2s] Skill '${skill.name}' has interactive {{ASK:}} prompts that were skipped in one-shot mode. Run interactively for full behaviour.\n`,
      );
    }
    substitutedTemplate = stripped;
    const effectivePrompt = substitutedTemplate + buildSkillContext(args);
    return { effectivePrompt, modelOverride: skill.model, routedSkillName: skill.name, unknownSkillName: null };
  }

  return { effectivePrompt: prompt, modelOverride: undefined, routedSkillName: null, unknownSkillName: skillName };
}

export async function oneShotMode(config: Config, prompt: string): Promise<void> {
  if (!(await checkCodexBinary(config))) process.exit(1);
  if (!checkOpenAIKey(config)) process.exit(1);
  if (!checkAnthropicKey(config)) process.exit(1);

  // Load persistent memory learnings from .phase2s/memory/learnings.jsonl
  const learningsList = await loadLearnings(process.cwd());
  const learningsStr = formatLearningsForPrompt(learningsList);
  if (learningsList.length > 0) {
    log.dim(`Learnings: ${learningsList.length} ${learningsList.length === 1 ? "entry" : "entries"} from .phase2s/memory/`);
  }

  // Sprint 56: load AGENTS.md (same logic as startReplMode() AGENTS.md load).
  // ENOENT is silent (file simply absent). Other errors (EACCES, EISDIR, etc.)
  // are surfaced as dim warnings so filesystem issues don't silently disappear.
  let agentsMdBlock: string | undefined;
  try {
    const agentsMdContent = await loadAgentsMd(process.cwd());
    agentsMdBlock = agentsMdContent ? formatAgentsMdBlock(agentsMdContent) : undefined;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      log.dim(`[phase2s] Could not load AGENTS.md (${code ?? "unknown"}) — skipping.`);
    }
  }

  const agent = new Agent({ config, learnings: learningsStr, agentsMdBlock });
  let hasOutput = false;

  // Skill routing: if prompt starts with "/" look up and run the named skill
  const skills = await loadAllSkills();
  const { effectivePrompt, modelOverride, routedSkillName, unknownSkillName } = resolveSkillRouting(prompt, skills);

  if (routedSkillName) {
    const resolvedModel = modelOverride ?? config.model ?? "default";
    process.stderr.write(`Routing to skill: ${routedSkillName} (model: ${resolvedModel})\n`);
  } else if (unknownSkillName) {
    process.stderr.write(`No skill named '${unknownSkillName}'. Running as plain prompt. Use 'phase2s skills' to list available skills.\n`);
  }

  try {
    const result = await agent.run(effectivePrompt, {
      modelOverride,
      onDelta: (chunk) => { process.stdout.write(chunk); hasOutput = true; },
    });
    if (!hasOutput) {
      // Fallback: tool-only path with no final text (rare in practice)
      process.stdout.write(result);
    }
    process.stdout.write("\n");
  } catch (err) {
    log.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

/**
 * Build context section to append to a skill's prompt template based on
 * the arguments the user typed after the skill name.
 *
 * `/review` → no context appended
 * `/review src/core/agent.ts` → "Focus on this file: src/core/agent.ts"
 * `/review src/core/agent.ts src/cli/index.ts` → "Focus on these files: ..."
 * `/investigate why does the REPL exit` → "Additional context: why does..."
 */
function buildSkillContext(args: string): string {
  if (!args) return "";

  // Split on whitespace and check if all tokens look like file paths
  // (contain a / or . suggesting a path/extension, no special chars)
  const tokens = args.split(/\s+/).filter(Boolean);
  const looksLikeFilePath = (s: string) =>
    /^[./~]/.test(s) || /\.\w{1,6}$/.test(s);

  const filePaths = tokens.filter(looksLikeFilePath);
  const rest = tokens.filter((t) => !looksLikeFilePath(t)).join(" ");

  const parts: string[] = [];

  if (filePaths.length === 1) {
    parts.push(`\n\nFocus on this file: ${filePaths[0]}`);
  } else if (filePaths.length > 1) {
    parts.push(`\n\nFocus on these files:\n${filePaths.map((f) => `  - ${f}`).join("\n")}`);
  }

  if (rest) {
    parts.push(`\n\nAdditional context: ${rest}`);
  }

  // If no file paths detected, treat whole thing as context
  if (filePaths.length === 0) {
    return `\n\nAdditional context: ${args}`;
  }

  return parts.join("");
}

function printHelp(skills: Array<{ name: string; description: string }>): void {
  console.log(chalk.bold("\nPhase2S Commands:\n"));
  console.log("  /help    — Show this help");
  console.log("  /quit    — Exit the session");
  console.log("  /exit    — Exit the session");
  console.log("  :compact — Compact conversation history to free context window");
  if (skills.length > 0) {
    console.log(chalk.bold("\nSkills:"));
    for (const skill of skills) {
      console.log(`  /${skill.name} — ${skill.description || "(no description)"}`);
    }
  }
  console.log();
}
