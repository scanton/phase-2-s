import { spawn } from "node:child_process";
import type { Config } from "../core/config.js";
import type { Provider, Message, ToolCall } from "./types.js";
import type { OpenAIFunctionDef } from "../tools/types.js";

/**
 * Codex CLI provider.
 *
 * Uses `codex exec` for non-interactive execution.
 * Codex handles its own tool calling internally (file read/write, shell, etc.)
 * and returns the final text response on stdout.
 *
 * Relevant flags:
 *   exec            — non-interactive mode
 *   -m <model>      — model to use
 *   --full-auto     — run without approval prompts (-a on-failure, --sandbox workspace-write)
 *   --json          — emit JSONL events (we use this to extract the final message)
 *   -C <dir>        — working directory
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
    // Build the full prompt: include system context + conversation history
    // then pass the latest user message as the exec prompt.
    const parts: string[] = [];

    const systemMessages = messages.filter((m) => m.role === "system");
    if (systemMessages.length > 0) {
      parts.push(systemMessages.map((m) => m.content).join("\n"));
      parts.push("---");
    }

    // Include prior conversation turns for context
    const nonSystem = messages.filter((m) => m.role !== "system");
    for (const msg of nonSystem) {
      if (msg.role === "user") {
        parts.push(`User: ${msg.content}`);
      } else if (msg.role === "assistant" && msg.content) {
        parts.push(`Assistant: ${msg.content}`);
      }
    }

    const prompt = parts.join("\n\n");

    // codex exec [OPTIONS] <PROMPT>
    const args = [
      "exec",
      "-m", this.model,
      "--full-auto",
      "-C", process.cwd(),
      "--color", "never",
      prompt,
    ];

    return new Promise((resolve, reject) => {
      const proc = spawn(this.codexPath, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        if (code !== 0 && !stdout) {
          reject(new Error(`Codex exited with code ${code}: ${stderr}`));
          return;
        }
        // Codex exec outputs the final agent response on stdout
        resolve({
          text: stdout.trim() || stderr.trim(),
          toolCalls: [],
        });
      });

      proc.on("error", (err) => {
        reject(new Error(`Failed to spawn codex: ${err.message}`));
      });
    });
  }
}
