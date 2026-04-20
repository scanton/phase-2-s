import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";

/**
 * Codex provider JSONL streaming tests.
 *
 * We can't run codex in CI (not installed), so we mock spawn() and feed
 * synthetic JSONL to exercise the streaming logic.
 */

// Mock child_process.spawn before importing CodexProvider
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

import { spawn } from "node:child_process";
import { CodexProvider } from "../../src/providers/codex.js";
import type { Config } from "../../src/core/config.js";
import type { ProviderEvent } from "../../src/providers/types.js";

const mockConfig: Config = {
  provider: "codex-cli",
  model: "test-model",
  codexPath: "codex",
  maxTurns: 50,
  timeout: 120000,
  allowDestructive: false,
  verifyCommand: "npm test",
  tools: [],
  deny: [],
  browser: false,
} as unknown as Config;

const mockMessages = [{ role: "user" as const, content: "Hello" }];

/**
 * Creates a mock child process that emits the given JSONL lines on stdout.
 * Lines are emitted asynchronously to simulate real streaming.
 */
function makeMockProc(jsonlLines: string[], exitCode = 0, errorMsg?: string) {
  const stdout = new Readable({ read() {} });
  const stderr = new Readable({ read() {} });
  const proc = new EventEmitter() as EventEmitter & {
    stdout: Readable;
    stderr: Readable;
  };
  proc.stdout = stdout;
  proc.stderr = stderr;

  // Emit lines asynchronously, then close
  setImmediate(async () => {
    if (errorMsg) {
      proc.emit("error", new Error(errorMsg));
      return;
    }
    for (const line of jsonlLines) {
      stdout.push(line + "\n");
      // Tiny delay to ensure async queue is exercised
      await new Promise((r) => setImmediate(r));
    }
    stdout.push(null); // EOF
    proc.emit("close", exitCode);
  });

  return proc;
}

async function collectEvents(provider: CodexProvider): Promise<ProviderEvent[]> {
  const events: ProviderEvent[] = [];
  for await (const event of provider.chatStream(mockMessages, [])) {
    events.push(event);
  }
  return events;
}

describe("CodexProvider JSONL streaming", () => {
  beforeEach(() => {
    vi.mocked(spawn).mockReset();
  });

  it("yields text event from a single agent_message", async () => {
    vi.mocked(spawn).mockReturnValue(
      makeMockProc([
        '{"type":"thread.started","thread_id":"abc"}',
        '{"type":"turn.started"}',
        '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"hello"}}',
        '{"type":"turn.completed","usage":{"input_tokens":100,"output_tokens":5}}',
      ]) as ReturnType<typeof spawn>,
    );

    const provider = new CodexProvider(mockConfig);
    const events = await collectEvents(provider);

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ type: "text", content: "hello" });
    expect(events[1]).toEqual({ type: "done", stopReason: "stop" });
  });

  it("yields multiple text events for multi-step tasks (one per agent_message)", async () => {
    vi.mocked(spawn).mockReturnValue(
      makeMockProc([
        '{"type":"turn.started"}',
        '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"Running now."}}',
        '{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"npm test"}}',
        '{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"npm test","aggregated_output":"PASS","exit_code":0,"status":"completed"}}',
        '{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"All 23 tests pass."}}',
        '{"type":"turn.completed","usage":{"input_tokens":500,"output_tokens":20}}',
      ]) as ReturnType<typeof spawn>,
    );

    const provider = new CodexProvider(mockConfig);
    const events = await collectEvents(provider);

    const textEvents = events.filter((e) => e.type === "text");
    expect(textEvents).toHaveLength(2);
    expect(textEvents[0]).toEqual({ type: "text", content: "Running now." });
    expect(textEvents[1]).toEqual({ type: "text", content: "All 23 tests pass." });
    expect(events[events.length - 1]).toEqual({ type: "done", stopReason: "stop" });
  });

  it("silently skips malformed JSONL lines and still yields valid events", async () => {
    vi.mocked(spawn).mockReturnValue(
      makeMockProc([
        '{"type":"thread.started","thread_id":"abc"}',
        "this is not json",
        '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"recovered"}}',
        "{ broken",
      ]) as ReturnType<typeof spawn>,
    );

    const provider = new CodexProvider(mockConfig);
    const events = await collectEvents(provider);

    expect(events[0]).toEqual({ type: "text", content: "recovered" });
    expect(events[events.length - 1]).toEqual({ type: "done", stopReason: "stop" });
  });

  it("throws on Codex error event", async () => {
    vi.mocked(spawn).mockReturnValue(
      makeMockProc([
        '{"type":"error","message":"stream error: unexpected status 400 Bad Request"}',
      ]) as ReturnType<typeof spawn>,
    );

    const provider = new CodexProvider(mockConfig);
    await expect(collectEvents(provider)).rejects.toThrow("Codex error:");
  });

  it("throws when process exits non-zero with no output", async () => {
    vi.mocked(spawn).mockReturnValue(
      makeMockProc(
        ['{"type":"thread.started","thread_id":"abc"}'],
        1, // non-zero exit
      ) as ReturnType<typeof spawn>,
    );

    const provider = new CodexProvider(mockConfig);
    await expect(collectEvents(provider)).rejects.toThrow("Codex exited with code 1");
  });

  it("throws 'Codex produced no output' when process exits 0 with no agent_messages", async () => {
    vi.mocked(spawn).mockReturnValue(
      makeMockProc(
        ['{"type":"thread.started","thread_id":"abc"}', '{"type":"turn.completed","usage":{"input_tokens":0,"output_tokens":0}}'],
        0,
      ) as ReturnType<typeof spawn>,
    );

    const provider = new CodexProvider(mockConfig);
    await expect(collectEvents(provider)).rejects.toThrow("Codex produced no output");
  });

  it("throws on spawn error", async () => {
    vi.mocked(spawn).mockReturnValue(
      makeMockProc([], 0, "spawn ENOENT") as ReturnType<typeof spawn>,
    );

    const provider = new CodexProvider(mockConfig);
    await expect(collectEvents(provider)).rejects.toThrow("Failed to spawn codex: spawn ENOENT");
  });

  it("command_execution items do not produce text events", async () => {
    vi.mocked(spawn).mockReturnValue(
      makeMockProc([
        '{"type":"item.completed","item":{"id":"item_0","type":"command_execution","command":"ls","aggregated_output":"file.ts","exit_code":0}}',
        '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"done"}}',
      ]) as ReturnType<typeof spawn>,
    );

    const provider = new CodexProvider(mockConfig);
    const events = await collectEvents(provider);

    const textEvents = events.filter((e) => e.type === "text");
    expect(textEvents).toHaveLength(1);
    expect(textEvents[0]).toEqual({ type: "text", content: "done" });
  });
});

// ---------------------------------------------------------------------------
// AbortSignal cooperative cancellation
// ---------------------------------------------------------------------------

describe("CodexProvider — AbortSignal cancellation", () => {
  beforeEach(() => {
    vi.mocked(spawn).mockReset();
  });

  it("calls proc.kill('SIGTERM') and stops streaming when signal is aborted", async () => {
    // Use a proc that never sends any output — it just hangs until aborted.
    const stdout = new Readable({ read() {} });
    const stderr = new Readable({ read() {} });
    const proc = new EventEmitter() as EventEmitter & {
      stdout: Readable;
      stderr: Readable;
      kill: ReturnType<typeof vi.fn>;
    };
    proc.stdout = stdout;
    proc.stderr = stderr;
    proc.kill = vi.fn(() => {
      // Simulate the process dying after SIGTERM
      proc.emit("close", null);
      return true;
    });

    vi.mocked(spawn).mockReturnValue(proc as ReturnType<typeof spawn>);

    const controller = new AbortController();
    const provider = new CodexProvider(mockConfig);

    // Abort immediately after the next microtask (before proc sends any output)
    const streamPromise = (async () => {
      const events: ProviderEvent[] = [];
      for await (const event of provider.chatStream(mockMessages, [], { signal: controller.signal })) {
        events.push(event);
      }
      return events;
    })();

    // Abort on next tick — process hasn't produced output yet
    await new Promise((r) => setImmediate(r));
    controller.abort();

    await streamPromise;
    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("passes signal through ChatStreamOptions — kill is called when signal is pre-aborted", async () => {
    // Pre-abort the signal before calling chatStream. The abort listener fires
    // synchronously when addEventListener is called (signal is already aborted).
    // We must iterate the generator to trigger the body execution.
    const controller = new AbortController();
    controller.abort(); // abort BEFORE chatStream

    const proc = new EventEmitter() as EventEmitter & {
      stdout: Readable;
      stderr: Readable;
      kill: ReturnType<typeof vi.fn>;
    };
    proc.stdout = new Readable({ read() {} });
    proc.stderr = new Readable({ read() {} });
    proc.kill = vi.fn(() => {
      // Simulate process death — no output was produced so we don't emit close here
      // (finish() is already called before kill in the impl)
      return true;
    });
    vi.mocked(spawn).mockReturnValue(proc as ReturnType<typeof spawn>);

    const provider = new CodexProvider(mockConfig);

    // Iterate the generator to trigger the body (generators are lazy)
    const events: ProviderEvent[] = [];
    for await (const event of provider.chatStream(mockMessages, [], { signal: controller.signal })) {
      events.push(event);
    }

    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
  });
});

// ---------------------------------------------------------------------------
// Rate limit detection via stderr (Sprint 58)
// ---------------------------------------------------------------------------

describe("CodexProvider rate limit detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Build a mock proc that writes stderrContent to stderr, produces no stdout,
   * then emits close with the given exit code.
   */
  function makeProcWithStderr(stderrContent: string, exitCode: number) {
    const stdout = new Readable({ read() {} });
    const stderr = new Readable({ read() {} });
    const proc = new EventEmitter() as EventEmitter & { stdout: Readable; stderr: Readable };
    proc.stdout = stdout;
    proc.stderr = stderr;

    setImmediate(() => {
      stderr.push(stderrContent);
      stderr.push(null);
      stdout.push(null);
      proc.emit("close", exitCode);
    });
    return proc;
  }

  it("yields rate_limited when stderr contains '429' and 'rate limit' keywords on non-zero exit", async () => {
    const proc = makeProcWithStderr("Error: 429 Too Many Requests\nYou've exceeded the rate limit.", 1);
    vi.mocked(spawn).mockReturnValue(proc as ReturnType<typeof spawn>);

    const provider = new CodexProvider(mockConfig);
    const events: ProviderEvent[] = [];
    for await (const event of provider.chatStream(mockMessages, [])) {
      events.push(event);
    }

    expect(events).toContainEqual({ type: "rate_limited" });
    // Should still emit done after rate_limited
    expect(events).toContainEqual({ type: "done", stopReason: "stop" });
  });

  it("yields error (not rate_limited) when stderr has 429 but no 'rate limit' keyword", async () => {
    const proc = makeProcWithStderr("HTTP status 429 — something else.", 1);
    vi.mocked(spawn).mockReturnValue(proc as ReturnType<typeof spawn>);

    const provider = new CodexProvider(mockConfig);
    await expect(async () => {
      for await (const _ of provider.chatStream(mockMessages, [])) { /* drain */ }
    }).rejects.toThrow("Codex exited with code 1");
  });

  it("yields error (not rate_limited) on generic non-zero exit without stderr keywords", async () => {
    const proc = makeProcWithStderr("some unrelated error output", 1);
    vi.mocked(spawn).mockReturnValue(proc as ReturnType<typeof spawn>);

    const provider = new CodexProvider(mockConfig);
    await expect(async () => {
      for await (const _ of provider.chatStream(mockMessages, [])) { /* drain */ }
    }).rejects.toThrow("Codex exited with code 1");
  });
});
