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
