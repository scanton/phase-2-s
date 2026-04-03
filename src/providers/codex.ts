import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Config } from "../core/config.js";
import type { Provider, Message, ToolCall } from "./types.js";
import type { OpenAIFunctionDef } from "../tools/types.js";

/**
 * Codex CLI provider.
 *
 * Uses `codex exec` in fully non-interactive scripting mode:
 *   --json                   suppresses the terminal UI (outputs JSONL instead)
 *   --output-last-message    writes the final response to a temp file
 *
 * This means codex never needs to open /dev/tty, so it cannot corrupt
 * the parent process's terminal/readline session.
 */
export class CodexProvider implements Provider {
  name = "codex-cli";
  private codexPath: string;
  private model: string;

  constructor(config: Config) {
    this.codexPath = config.codexPath;
    this.model = config.model;
  }

  async chat(
    messages: Message[],
    _tools: OpenAIFunctionDef[],
  ): Promise<{ text: string; toolCalls: ToolCall[] }> {
    // Build the full prompt: system context + conversation history
    const parts: string[] = [];

    const systemMessages = messages.filter((m) => m.role === "system");
    if (systemMessages.length > 0) {
      parts.push(systemMessages.map((m) => m.content).join("\n"));
      parts.push("---");
    }

    const nonSystem = messages.filter((m) => m.role !== "system");
    for (const msg of nonSystem) {
      if (msg.role === "user") {
        parts.push(`User: ${msg.content}`);
      } else if (msg.role === "assistant" && msg.content) {
        parts.push(`Assistant: ${msg.content}`);
      }
    }

    const prompt = parts.join("\n\n");

    // Use a temp dir for the output file so we don't pollute the project
    const tmpDir = await mkdtemp(join(tmpdir(), "phase2s-"));
    const outputFile = join(tmpDir, "last-message.txt");

    // codex exec --json suppresses the interactive UI (no /dev/tty access)
    // --output-last-message writes the final response to a file we control
    const args = [
      "exec",
      "-m", this.model,
      "--full-auto",
      "-C", process.cwd(),
      "--json",
      "--output-last-message", outputFile,
      prompt,
    ];

    return new Promise((resolve, reject) => {
      const proc = spawn(this.codexPath, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          NO_COLOR: "1",
          FORCE_COLOR: "0",
        },
      });

      let stderr = "";

      proc.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on("close", async (code) => {
        // Try reading the output file first (most reliable)
        try {
          const text = await readFile(outputFile, "utf-8");
          await rm(tmpDir, { recursive: true }).catch(() => {});
          resolve({ text: text.trim(), toolCalls: [] });
          return;
        } catch {
          // Output file missing — fall through to error handling
        }

        await rm(tmpDir, { recursive: true }).catch(() => {});

        if (code !== 0) {
          reject(new Error(`Codex exited with code ${code}: ${stderr.trim()}`));
          return;
        }

        // Unexpected: exited 0 but no output file
        reject(new Error("Codex produced no output"));
      });

      proc.on("error", async (err) => {
        await rm(tmpDir, { recursive: true }).catch(() => {});
        reject(new Error(`Failed to spawn codex: ${err.message}`));
      });
    });
  }
}
