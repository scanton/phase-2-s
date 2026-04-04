import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Config } from "../core/config.js";
import type { Provider, Message, ToolCall, ProviderEvent } from "./types.js";
import type { OpenAIFunctionDef } from "../tools/types.js";

/** Track all temp dirs created this process so we can clean up on crash/exit. */
const activeTempDirs = new Set<string>();

function cleanupTempDirs(): void {
  // Synchronous cleanup — rmSync is available here (unlike the async rm).
  for (const dir of activeTempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best-effort — ignore errors (e.g. already deleted by normal path)
    }
  }
}

process.on("exit", cleanupTempDirs);
// SIGTERM and SIGINT don't trigger "exit" automatically — register them explicitly
// so that temp dirs (which may contain prompt text) are cleaned up on Ctrl+C and kill.
process.on("SIGTERM", () => {
  cleanupTempDirs();
  process.exit(0);
});
process.on("SIGINT", () => {
  cleanupTempDirs();
  process.exit(0);
});

/**
 * Codex CLI provider.
 *
 * Uses `codex exec` in fully non-interactive scripting mode:
 *   --json                   suppresses the terminal UI (outputs JSONL instead)
 *   --output-last-message    writes the final response to a temp file
 *
 * This means codex never needs to open /dev/tty, so it cannot corrupt
 * the parent process's terminal/readline session.
 *
 * Real Codex streaming is deferred — the JSONL stdout format is undocumented.
 * `chatStream()` wraps `_chat()` in a passthrough single-event generator
 * (same batch UX as before, but through the Provider streaming interface).
 * Tool calling is not supported via the --output-last-message mechanism;
 * toolCalls is always [].
 */
export class CodexProvider implements Provider {
  name = "codex-cli";
  private codexPath: string;
  private model: string;

  constructor(config: Config) {
    this.codexPath = config.codexPath;
    this.model = config.model;
  }

  async *chatStream(
    messages: Message[],
    tools: OpenAIFunctionDef[],
    options?: import("./types.js").ChatStreamOptions,
  ): AsyncIterable<ProviderEvent> {
    const result = await this._chat(messages, tools, options?.model);
    if (result.text) {
      yield { type: "text", content: result.text };
    }
    // Codex provider currently always returns toolCalls: [] — tool calling
    // is not supported via the --output-last-message mechanism.
    if (result.toolCalls.length > 0) {
      yield { type: "tool_calls", calls: result.toolCalls };
      yield { type: "done", stopReason: "tool_calls" };
    } else {
      yield { type: "done", stopReason: "stop" };
    }
  }

  private async _chat(
    messages: Message[],
    _tools: OpenAIFunctionDef[],
    modelOverride?: string,
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
    activeTempDirs.add(tmpDir);
    const outputFile = join(tmpDir, "last-message.txt");

    // codex exec --json suppresses the interactive UI (no /dev/tty access)
    // --output-last-message writes the final response to a file we control
    //
    // The "--" separator signals end-of-flags to codex's own arg parser.
    // Without it, a prompt beginning with "--" (e.g. "--help" or "--flags")
    // would be misinterpreted as a codex CLI flag rather than as the prompt.
    // spawn() with an array is NOT shell-injected, so this is the only risk.
    const args = [
      "exec",
      "-m", modelOverride ?? this.model,
      "--full-auto",
      "-C", process.cwd(),
      "--json",
      "--output-last-message", outputFile,
      "--",
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

      // Consume stdout (JSONL events) so the pipe buffer never fills and
      // blocks codex. We don't parse it — we use --output-last-message instead.
      proc.stdout.resume();

      proc.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on("close", async (code) => {
        // Try reading the output file first (most reliable)
        try {
          const text = await readFile(outputFile, "utf-8");
          await rm(tmpDir, { recursive: true }).catch(() => {});
          activeTempDirs.delete(tmpDir);
          resolve({ text: text.trim(), toolCalls: [] });
          return;
        } catch {
          // Output file missing — fall through to error handling
        }

        await rm(tmpDir, { recursive: true }).catch(() => {});
        activeTempDirs.delete(tmpDir);

        if (code !== 0) {
          reject(new Error(`Codex exited with code ${code}: ${stderr.trim()}`));
          return;
        }

        // Unexpected: exited 0 but no output file
        reject(new Error("Codex produced no output"));
      });

      proc.on("error", async (err) => {
        await rm(tmpDir, { recursive: true }).catch(() => {});
        activeTempDirs.delete(tmpDir);
        reject(new Error(`Failed to spawn codex: ${err.message}`));
      });
    });
  }
}
