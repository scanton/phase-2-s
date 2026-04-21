import { spawn } from "node:child_process";
import type { Config } from "../core/config.js";
import type { Provider, Message, ProviderEvent } from "./types.js";
import type { OpenAIFunctionDef } from "../tools/types.js";

// ---------------------------------------------------------------------------
// Codex JSONL event types (format confirmed via spike on 2026-04-04)
//
// Example output from `codex exec --full-auto --json -- "<prompt>"`:
//   {"type":"thread.started","thread_id":"..."}
//   {"type":"turn.started"}
//   {"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"hello"}}
//   {"type":"turn.completed","usage":{"input_tokens":6189,"output_tokens":22}}
//
// Multi-step (with tool calls):
//   {"type":"item.completed","item":{"type":"agent_message","text":"Running now..."}}
//   {"type":"item.started","item":{"type":"command_execution","command":"npm test",...}}
//   {"type":"item.completed","item":{"type":"command_execution",...,"exit_code":0}}
//   {"type":"item.completed","item":{"type":"agent_message","text":"All tests pass."}}
//
// Error:
//   {"type":"error","message":"stream error: ..."}
// ---------------------------------------------------------------------------

interface CodexAgentMessage {
  id: string;
  type: "agent_message";
  text: string;
}

interface CodexCommandExecution {
  id: string;
  type: "command_execution";
  command: string;
  aggregated_output: string;
  exit_code?: number;
  status?: string;
}

type CodexItem = CodexAgentMessage | CodexCommandExecution | { id: string; type: string };

type CodexJsonlEvent =
  | { type: "thread.started"; thread_id: string }
  | { type: "turn.started" }
  | { type: "item.started"; item: CodexItem }
  | { type: "item.completed"; item: CodexItem }
  | { type: "turn.completed"; usage: { input_tokens: number; cached_input_tokens?: number; output_tokens: number } }
  | { type: "error"; message: string };

function isAgentMessage(item: CodexItem): item is CodexAgentMessage {
  return item.type === "agent_message" && "text" in item;
}

/**
 * Codex CLI provider.
 *
 * Uses `codex exec` in fully non-interactive scripting mode:
 *   --json      suppresses the terminal UI, outputs JSONL events on stdout
 *
 * Each `item.completed` event with `type: "agent_message"` is yielded immediately
 * as a `{ type: "text" }` ProviderEvent. Multi-step tasks (with tool calls) produce
 * multiple agent_message items, so callers see real-time step-by-step progress rather
 * than waiting for the entire run to finish.
 *
 * Malformed JSONL lines are silently skipped.
 * Tool calling is not surfaced via this mechanism; toolCalls is always [].
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
    _tools: OpenAIFunctionDef[],
    options?: import("./types.js").ChatStreamOptions,
  ): AsyncIterable<ProviderEvent> {
    const model = options?.model ?? this.model;

    // Build the full prompt: system context + conversation history
    const parts: string[] = [];
    const systemMessages = messages.filter((m) => m.role === "system");
    if (systemMessages.length > 0) {
      parts.push(systemMessages.map((m) => m.content).join("\n"));
      parts.push("---");
    }
    for (const msg of messages.filter((m) => m.role !== "system")) {
      if (msg.role === "user") {
        parts.push(`User: ${msg.content}`);
      } else if (msg.role === "assistant" && msg.content) {
        parts.push(`Assistant: ${msg.content}`);
      }
    }
    const prompt = parts.join("\n\n");

    // codex exec --json suppresses the interactive UI and outputs JSONL on stdout.
    // The "--" separator signals end-of-flags so prompts beginning with "--" are safe.
    // spawn() with an array is NOT shell-injected, so this is the only prompt-injection risk.
    const args = [
      "exec",
      "-m", model,
      "--full-auto",
      "-C", process.cwd(),
      "--json",
      "--",
      prompt,
    ];

    const proc = spawn(this.codexPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        NO_COLOR: "1",
        FORCE_COLOR: "0",
      },
    });

    // -------------------------------------------------------------------------
    // Async queue: bridges the event-emitter world → async generator.
    //
    // We can't `yield` from inside event handlers, so we push events into a
    // queue and use a one-shot resolve callback to wake the generator loop.
    // -------------------------------------------------------------------------
    const pendingEvents: ProviderEvent[] = [];
    let finished = false;
    let finishError: Error | null = null;
    let wakeUp: (() => void) | null = null;
    let hasProducedText = false;

    const push = (event: ProviderEvent): void => {
      pendingEvents.push(event);
      wakeUp?.();
      wakeUp = null;
    };

    const finish = (err?: Error): void => {
      if (finished) return; // Guard: called at most once
      finished = true;
      finishError = err ?? null;
      wakeUp?.();
      wakeUp = null;
    };

    // Cooperative cancellation: if the caller aborts, kill the codex process.
    // Call finish() BEFORE proc.kill() so that the synchronous "close" event
    // emitted by the OS (or mock) after kill sees finished=true and skips the
    // "exited with code null" error path.
    // Defined after finish() so the handler can reference it safely.
    // Also check signal.aborted immediately — addEventListener does not fire
    // retroactively for signals that were already aborted before the listener was added.
    const abortHandler = () => {
      finish();
      try {
        proc.kill("SIGTERM");
      } catch {
        // ESRCH: process already exited between the abort and the kill — safe to ignore.
      }
    };
    options?.signal?.addEventListener("abort", abortHandler, { once: true });
    if (options?.signal?.aborted) {
      abortHandler();
    }

    // JSONL line parser — called for each complete line from stdout
    const processLine = (line: string): void => {
      if (!line) return;
      let evt: CodexJsonlEvent;
      try {
        evt = JSON.parse(line) as CodexJsonlEvent;
      } catch {
        // Silent fallback: malformed JSONL line, skip it
        return;
      }

      if (evt.type === "item.completed" && isAgentMessage(evt.item)) {
        hasProducedText = true;
        push({ type: "text", content: evt.item.text });
      } else if (evt.type === "error") {
        finish(new Error(`Codex error: ${evt.message}`));
      }
    };

    // Stream stdout, splitting on newlines as chunks arrive
    let lineBuffer = "";
    proc.stdout.on("data", (chunk: Buffer) => {
      lineBuffer += chunk.toString();
      let newlineIdx: number;
      while ((newlineIdx = lineBuffer.indexOf("\n")) !== -1) {
        processLine(lineBuffer.slice(0, newlineIdx).trim());
        lineBuffer = lineBuffer.slice(newlineIdx + 1);
      }
    });

    // Accumulate stderr — pipe buffer must not fill or codex blocks.
    // Capped at 64 KB to prevent unbounded growth on noisy stderr.
    // We check for rate-limit keywords ("429" + "rate limit") on close.
    const STDERR_MAX_BYTES = 64 * 1024;
    let stderrBuffer = "";
    proc.stderr.on("data", (chunk: Buffer) => {
      if (Buffer.byteLength(stderrBuffer) < STDERR_MAX_BYTES) {
        stderrBuffer += chunk.toString();
      }
    });

    proc.on("close", (code) => {
      if (finished) return;
      // Flush any remaining content without a trailing newline
      const remaining = lineBuffer.trim();
      if (remaining) processLine(remaining);

      if (code !== 0) {
        // Always check stderr for a rate-limit signal, even if text was already produced.
        // Codex can stream partial output and then hit a 429 mid-run; the stderr check
        // must not be gated on !hasProducedText or those cases are silently swallowed.
        const stderrLower = stderrBuffer.toLowerCase();
        if (stderrLower.includes("429") && stderrLower.includes("rate limit")) {
          push({ type: "rate_limited" });
          finish();
        } else if (!hasProducedText) {
          finish(new Error(`Codex exited with code ${code ?? "null"}`));
        } else {
          // Non-zero exit but text was produced — treat as done (best-effort output).
          finish();
        }
      } else if (!hasProducedText) {
        finish(new Error("Codex produced no output"));
      } else {
        finish();
      }
    });

    proc.on("error", (err) => {
      finish(new Error(`Failed to spawn codex: ${err.message}`));
    });

    // Generator loop: drain the queue, wait for more, repeat until done.
    // try/finally ensures the abort listener is removed when the generator exits
    // (normal return, throw, or early .return() from consumer) so the shared
    // sigintController.signal doesn't accumulate stale listeners across turns.
    try {
      while (true) {
        while (pendingEvents.length > 0) {
          yield pendingEvents.shift()!;
        }
        if (finished) {
          if (finishError) throw finishError;
          yield { type: "done", stopReason: "stop" };
          return;
        }
        // Wait for the next push() or finish() call
        await new Promise<void>((resolve) => {
          wakeUp = resolve;
        });
      }
    } finally {
      options?.signal?.removeEventListener("abort", abortHandler);
    }
  }
}
