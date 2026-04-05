import { Command } from "commander";
import { createInterface } from "node:readline";
import { access, constants, readdir } from "node:fs/promises";
import { mkdirSync, writeFileSync } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import { execSync } from "node:child_process";
import { join, resolve } from "node:path";
import chalk from "chalk";
import { loadConfig, type Config } from "../core/config.js";
import { Agent } from "../core/agent.js";
import { Conversation } from "../core/conversation.js";
import { loadLearnings, formatLearningsForPrompt } from "../core/memory.js";
import { loadAllSkills } from "../skills/index.js";
import { substituteInputs, getUnfilledInputKeys } from "../skills/template.js";
import { log } from "../utils/logger.js";

const VERSION = "0.18.0";

/** Directory for session auto-saves. */
const SESSION_DIR = join(process.cwd(), ".phase2s", "sessions");

/** Path for today's session file. */
function todaySessionPath(): string {
  const d = new Date();
  const datePart = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return join(SESSION_DIR, `${datePart}.json`);
}

/**
 * Find the most recent session file in SESSION_DIR.
 * Returns null if no session files exist.
 */
async function findLatestSession(): Promise<string | null> {
  let entries: string[];
  try {
    entries = await readdir(SESSION_DIR);
  } catch {
    return null;
  }
  // Only match YYYY-MM-DD.json filenames so stray .json files don't become sessions.
  const sessions = entries
    .filter((e) => /^\d{4}-\d{2}-\d{2}\.json$/.test(e))
    .sort()
    .reverse();
  return sessions.length > 0 ? join(SESSION_DIR, sessions[0]) : null;
}

export async function main(argv: string[] = process.argv): Promise<void> {
  const program = new Command();

  program
    .name("phase2s")
    .description("AI programming harness with multi-model support")
    .version(VERSION)
    .option("-p, --provider <provider>", "LLM provider (codex-cli | openai-api)")
    .option("-m, --model <model>", "Model to use")
    .option("--system <prompt>", "Custom system prompt")
    .option("--resume", "Resume the most recent session");

  // Default command: interactive REPL
  program
    .command("chat", { isDefault: true })
    .description("Start an interactive chat session")
    .action(async () => {
      const opts = program.opts();
      const config = await loadConfig({
        provider: opts.provider,
        model: opts.model,
        systemPrompt: opts.system,
      });
      await interactiveMode(config, { resume: !!opts.resume });
    });

  // One-shot mode
  program
    .command("run <prompt>")
    .description("Run a single prompt and exit")
    .action(async (prompt: string) => {
      const opts = program.opts();
      const config = await loadConfig({
        provider: opts.provider,
        model: opts.model,
        systemPrompt: opts.system,
      });
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
    .command("skills")
    .description("List available skills")
    .action(async () => {
      const skills = await loadAllSkills();
      if (skills.length === 0) {
        log.info("No skills found. Add skills to .phase2s/skills/ or ~/.phase2s/skills/");
        return;
      }
      console.log(chalk.bold("\nAvailable skills:\n"));
      for (const skill of skills) {
        console.log(`  ${chalk.cyan("/" + skill.name)} — ${skill.description || "(no description)"}`);
      }
      console.log();
    });

  await program.parseAsync(argv);
}

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
async function interactiveMode(config: Config, opts: { resume?: boolean } = {}): Promise<void> {
  if (!(await checkCodexBinary(config))) process.exit(1);
  if (!checkOpenAIKey(config)) process.exit(1);
  if (!checkAnthropicKey(config)) process.exit(1);

  // --resume: load most recent session
  let resumedConversation: Conversation | undefined;
  if (opts.resume) {
    const sessionPath = await findLatestSession();
    if (sessionPath) {
      try {
        resumedConversation = await Conversation.load(sessionPath);
        console.log(chalk.dim(`Resuming session from ${sessionPath} (${resumedConversation.length} messages)\n`));
      } catch {
        console.log(chalk.yellow("Warning: Could not load previous session. Starting fresh.\n"));
      }
    } else {
      console.log(chalk.yellow("No previous session found. Starting fresh.\n"));
    }
  }

  console.log(chalk.bold(`\nPhase2S v${VERSION}`));
  console.log(chalk.dim("Type your message and press Enter. Type /quit to exit.\n"));

  // Load persistent memory learnings from .phase2s/memory/learnings.jsonl
  const learningsList = await loadLearnings(process.cwd());
  const learningsStr = formatLearningsForPrompt(learningsList);
  if (learningsList.length > 0) {
    log.dim(`Learnings: ${learningsList.length} ${learningsList.length === 1 ? "entry" : "entries"} from .phase2s/memory/`);
  }

  const agent = new Agent({ config, conversation: resumedConversation, learnings: learningsStr });
  const skills = await loadAllSkills();

  // Session auto-save path — today's file
  const sessionPath = todaySessionPath();

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
    // Synchronous save before exit — async saveSession() can't complete after process.exit().
    try {
      mkdirSync(resolve(sessionPath, ".."), { recursive: true });
      writeFileSync(sessionPath, JSON.stringify(agent.getConversation().getMessages(), null, 2), { encoding: "utf-8", mode: 0o600 });
    } catch {
      // Best-effort — don't block exit on save failure
    }
    log.info("Goodbye!");
    rl.close();
    process.exit(0);
  });

  /** Wait for the next line of input. Returns null if stdin closes. */
  const nextLine = (): Promise<string | null> => {
    if (lineQueue.length > 0) return Promise.resolve(lineQueue.shift()!);
    if (!isOpen) return Promise.resolve(null);
    return new Promise((resolve) => {
      pendingResolve = resolve;
    });
  };

  /** Save the current conversation to today's session file (best-effort). */
  const saveSession = async (): Promise<void> => {
    try {
      // mode 0o600: session files may contain code, file paths, or secrets —
      // restrict to owner-only to prevent world-readable exposure on multi-user systems.
      await agent.getConversation().save(sessionPath, 0o600);
    } catch {
      // Best-effort — session save failures don't interrupt the user
    }
  };

  const writePrompt = () => process.stdout.write(chalk.green("you > "));

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
      process.exit(0);
    }

    if (trimmed === "/help") {
      printHelp(skills);
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
          process.stdout.write(chalk.cyan(`  ${inputDef.prompt} `));
          const answer = await nextLine();
          inputValues[key] = answer?.trim() ?? "";
        }
        const substitutedTemplate = substituteInputs(skill.promptTemplate, inputValues, skill.inputs);
        const finalExpanded = substitutedTemplate + buildSkillContext(safeArgs);

        process.stdout.write(chalk.dim(`Running /${skill.name}${safeArgs ? ` on: ${safeArgs}` : ""}...\n`));

        // Satori mode: skill declares retries > 0
        if (skill.retries && skill.retries > 0) {
          const slug = makeSlug(finalExpanded.slice(0, 100));
          const startedAt = new Date().toISOString();
          const attempts: import("../core/agent.js").SatoriResult[] = [];

          try {
            const response = await agent.run(finalExpanded, {
              modelOverride: skill.model,
              maxRetries: skill.retries,
              verifyCommand: config.verifyCommand,
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
          try {
            const response = await agent.run(finalExpanded, { modelOverride: skill.model });
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
    process.stdout.write(chalk.bold("\nassistant > "));
    try {
      await agent.run(trimmed, { onDelta: (chunk) => process.stdout.write(chunk) });
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
    const substitutedTemplate = substituteInputs(skill.promptTemplate, {}, skill.inputs);
    const effectivePrompt = substitutedTemplate + buildSkillContext(args);
    return { effectivePrompt, modelOverride: skill.model, routedSkillName: skill.name, unknownSkillName: null };
  }

  return { effectivePrompt: prompt, modelOverride: undefined, routedSkillName: null, unknownSkillName: skillName };
}

async function oneShotMode(config: Config, prompt: string): Promise<void> {
  if (!(await checkCodexBinary(config))) process.exit(1);
  if (!checkOpenAIKey(config)) process.exit(1);
  if (!checkAnthropicKey(config)) process.exit(1);

  // Load persistent memory learnings from .phase2s/memory/learnings.jsonl
  const learningsList = await loadLearnings(process.cwd());
  const learningsStr = formatLearningsForPrompt(learningsList);
  if (learningsList.length > 0) {
    log.dim(`Learnings: ${learningsList.length} ${learningsList.length === 1 ? "entry" : "entries"} from .phase2s/memory/`);
  }

  const agent = new Agent({ config, learnings: learningsStr });
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
  if (skills.length > 0) {
    console.log(chalk.bold("\nSkills:"));
    for (const skill of skills) {
      console.log(`  /${skill.name} — ${skill.description || "(no description)"}`);
    }
  }
  console.log();
}
