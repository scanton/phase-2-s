import { spawn } from "node:child_process";
import type { Config } from "../core/config.js";
import type { Provider, Message, ToolCall } from "./types.js";
import type { OpenAIFunctionDef } from "../tools/types.js";

/**
 * Codex CLI provider.
 *
 * Spawns the `codex` CLI as a subprocess and communicates via stdin/stdout.
 * This wraps the interactive Codex session, sending the user's prompt and
 * parsing the response.
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
    // Build the prompt from messages
    const userMessages = messages.filter((m) => m.role === "user");
    const lastUserMessage = userMessages[userMessages.length - 1]?.content ?? "";

    // Build system prompt from system messages
    const systemMessages = messages.filter((m) => m.role === "system");
    const systemPrompt = systemMessages.map((m) => m.content).join("\n");

    const args = ["--quiet", "--model", this.model];
    if (systemPrompt) {
      args.push("--instructions", systemPrompt);
    }
    // Full-auto mode so Codex handles tool execution internally
    args.push("--approval-mode", "full-auto");
    args.push(lastUserMessage);

    return new Promise((resolve, reject) => {
      const proc = spawn(this.codexPath, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
        cwd: process.cwd(),
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
        // In full-auto mode, Codex handles tool calls internally
        // and returns the final text output
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
