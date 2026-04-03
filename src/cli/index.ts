import { Command } from "commander";
import { createInterface } from "node:readline";
import chalk from "chalk";
import ora from "ora";
import { loadConfig, type Config } from "../core/config.js";
import { Agent } from "../core/agent.js";
import { loadAllSkills } from "../skills/index.js";
import { log } from "../utils/logger.js";

const VERSION = "0.1.0";

export async function main(argv: string[] = process.argv): Promise<void> {
  const program = new Command();

  program
    .name("phase2s")
    .description("AI programming harness with multi-model support")
    .version(VERSION)
    .option("-p, --provider <provider>", "LLM provider (codex-cli | openai-api)")
    .option("-m, --model <model>", "Model to use")
    .option("--system <prompt>", "Custom system prompt");

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
      await interactiveMode(config);
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

/**
 * Interactive REPL.
 *
 * Uses a manual event-queue pattern (rl.on('line')) rather than the
 * readline async iterator. The async iterator has a known issue where
 * it terminates if the event loop drains while awaiting between turns —
 * which is exactly what happens while codex is running.
 */
async function interactiveMode(config: Config): Promise<void> {
  console.log(chalk.bold(`\nPhase2S v${VERSION}`));
  console.log(chalk.dim("Type your message and press Enter. Type /quit to exit.\n"));

  const agent = new Agent({ config });
  const skills = await loadAllSkills();

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

    // Skill invocation
    if (trimmed.startsWith("/")) {
      const skillName = trimmed.slice(1).split(" ")[0];
      const skill = skills.find((s) => s.name === skillName);
      if (skill) {
        const rest = trimmed.slice(1 + skillName.length).trim();
        const expanded = skill.promptTemplate + (rest ? `\n\nUser context: ${rest}` : "");
        process.stdout.write(chalk.dim("Thinking...\n"));
        try {
          const response = await agent.run(expanded);
          console.log(chalk.bold("\nassistant > ") + response + "\n");
        } catch (err) {
          log.error(err instanceof Error ? err.message : String(err));
        }
        continue;
      }
    }

    // Normal message — no spinner (ora can interact with stdin state)
    process.stdout.write(chalk.dim("Thinking...\n"));
    try {
      const response = await agent.run(trimmed);
      console.log(chalk.bold("\nassistant > ") + response + "\n");
    } catch (err) {
      log.error(err instanceof Error ? err.message : String(err));
    }
  }
}

async function oneShotMode(config: Config, prompt: string): Promise<void> {
  const agent = new Agent({ config });
  const spinner = ora("Thinking...").start();

  try {
    const response = await agent.run(prompt);
    spinner.stop();
    console.log(response);
  } catch (err) {
    spinner.stop();
    log.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
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
