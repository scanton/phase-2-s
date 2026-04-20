import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { translateMessages, AnthropicProvider } from "../../src/providers/anthropic.js";
import * as openaiModule from "../../src/providers/openai.js";
import type { Message } from "../../src/providers/types.js";
import type { Config } from "../../src/core/config.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal Config for testing AnthropicProvider.
 * We inject a mock client, so api key values don't matter for most tests.
 */
function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    provider: "anthropic",
    model: "claude-3-5-sonnet-20241022",
    apiKey: undefined,
    anthropicApiKey: "test-key",
    anthropicMaxTokens: 8192,
    ollamaBaseUrl: undefined,
    fast_model: undefined,
    smart_model: undefined,
    codexPath: "codex",
    systemPrompt: undefined,
    maxTurns: 50,
    timeout: 120_000,
    allowDestructive: false,
    verifyCommand: "npm test",
    requireSpecification: false,
    tools: undefined,
    deny: undefined,
    ...overrides,
  } as Config;
}

/**
 * Create an async iterable from an array of events.
 * Cast to unknown to satisfy the Anthropic Stream type in tests.
 */
function mockStream(events: object[]): AsyncIterable<object> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) yield event;
    },
  };
}

// ---------------------------------------------------------------------------
// translateMessages — exported for direct testing
// ---------------------------------------------------------------------------

describe("translateMessages", () => {
  it("passes through plain user and assistant messages unchanged", () => {
    const msgs: Message[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ];
    const result = translateMessages(msgs);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ role: "user", content: "Hello" });
    expect(result[1]).toEqual({ role: "assistant", content: "Hi there" });
  });

  it("converts assistant + toolCalls to tool_use content blocks", () => {
    const msgs: Message[] = [
      {
        role: "assistant",
        content: "Let me check that",
        toolCalls: [{ id: "tc1", name: "file_read", arguments: '{"path":"foo.ts"}' }],
      },
    ];
    const result = translateMessages(msgs);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("assistant");
    const content = result[0].content as object[];
    expect(content).toHaveLength(2);
    expect(content[0]).toEqual({ type: "text", text: "Let me check that" });
    expect(content[1]).toMatchObject({ type: "tool_use", id: "tc1", name: "file_read" });
    expect((content[1] as { input: unknown }).input).toEqual({ path: "foo.ts" });
  });

  it("converts tool role to synthetic user message with tool_result block", () => {
    const msgs: Message[] = [
      { role: "tool", content: "file contents here", toolCallId: "tc1" },
    ];
    const result = translateMessages(msgs);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("user");
    const content = result[0].content as object[];
    expect(content).toHaveLength(1);
    expect(content[0]).toEqual({ type: "tool_result", tool_use_id: "tc1", content: "file contents here" });
  });

  it("folds consecutive tool results into a single synthetic user message", () => {
    const msgs: Message[] = [
      { role: "tool", content: "result A", toolCallId: "tc1" },
      { role: "tool", content: "result B", toolCallId: "tc2" },
    ];
    const result = translateMessages(msgs);
    // Both tool results must fold into ONE user message (not two)
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("user");
    const content = result[0].content as object[];
    expect(content).toHaveLength(2);
    expect(content[0]).toMatchObject({ type: "tool_result", tool_use_id: "tc1" });
    expect(content[1]).toMatchObject({ type: "tool_result", tool_use_id: "tc2" });
  });

  it("excludes system messages from the translated array", () => {
    const msgs: Message[] = [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Do something" },
    ];
    const result = translateMessages(msgs);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("user");
  });

  it("merges a plain user message following tool results into the same synthetic user message (prevents Anthropic 400)", () => {
    // Reproduces the tool error reflection scenario: after tool results, agent.ts injects
    // a plain user message via addUser(TOOL_ERROR_REFLECTION_FRAGMENT). Without the merge,
    // this creates two consecutive user messages which the Anthropic API rejects with 400.
    const msgs = [
      { role: "user" as const, content: "do the thing" },
      { role: "assistant" as const, content: "calling tool", toolCalls: [{ id: "tc1", name: "fail_tool", arguments: "{}" }] },
      { role: "tool" as const, content: "Error: intentional failure", toolCallId: "tc1" },
      { role: "user" as const, content: "## Tool failure reflection\nBefore retrying..." },
    ];
    const result = translateMessages(msgs);
    // Should produce: user, assistant, user — NOT user, assistant, user, user
    expect(result).toHaveLength(3);
    expect(result[0].role).toBe("user");
    expect(result[1].role).toBe("assistant");
    expect(result[2].role).toBe("user");
    // The synthetic user message must contain both the tool_result AND the reflection text
    const synthUser = result[2];
    expect(Array.isArray(synthUser.content)).toBe(true);
    const blocks = synthUser.content as Array<{ type: string }>;
    expect(blocks.some((b) => b.type === "tool_result")).toBe(true);
    expect(blocks.some((b) => b.type === "text")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AnthropicProvider — streaming
// ---------------------------------------------------------------------------

describe("AnthropicProvider", () => {
  it("throws if no API key is provided (no env var, no config key)", () => {
    const origKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect(() => new AnthropicProvider(makeConfig({ anthropicApiKey: undefined }))).toThrow(
        /Anthropic API key is required/,
      );
    } finally {
      if (origKey !== undefined) process.env.ANTHROPIC_API_KEY = origKey;
    }
  });

  it("yields text content from text_delta events", async () => {
    const events = [
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " world" } },
      { type: "message_delta", delta: { stop_reason: "end_turn" } },
      { type: "message_stop" },
    ];

    const mockClient = {
      messages: { stream: vi.fn().mockReturnValue(mockStream(events)) },
    };

    const provider = new AnthropicProvider(makeConfig(), mockClient as never);
    const collected: string[] = [];
    for await (const event of provider.chatStream(
      [{ role: "user", content: "hi" }],
      [],
    )) {
      if (event.type === "text") collected.push(event.content);
    }
    expect(collected).toEqual(["Hello", " world"]);
  });

  it("yields tool_calls from tool_use content blocks", async () => {
    const events = [
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "tc1", name: "file_read" },
      },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"path"' } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: ':"foo.ts"}' } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "tool_use" } },
      { type: "message_stop" },
    ];

    const mockClient = {
      messages: { stream: vi.fn().mockReturnValue(mockStream(events)) },
    };

    const provider = new AnthropicProvider(makeConfig(), mockClient as never);
    const toolEvents: object[] = [];
    for await (const event of provider.chatStream(
      [{ role: "user", content: "read the file" }],
      [],
    )) {
      if (event.type === "tool_calls") toolEvents.push(event);
    }
    expect(toolEvents).toHaveLength(1);
    const te = toolEvents[0] as { type: string; calls: Array<{ id: string; name: string; arguments: string }> };
    expect(te.calls).toHaveLength(1);
    expect(te.calls[0].id).toBe("tc1");
    expect(te.calls[0].name).toBe("file_read");
    expect(te.calls[0].arguments).toBe('{"path":"foo.ts"}');
  });

  it("extracts system message as top-level system param (not in messages array)", async () => {
    const events = [
      { type: "message_delta", delta: { stop_reason: "end_turn" } },
      { type: "message_stop" },
    ];

    const mockClient = {
      messages: { stream: vi.fn().mockReturnValue(mockStream(events)) },
    };

    const provider = new AnthropicProvider(makeConfig(), mockClient as never);
    const msgs: Message[] = [
      { role: "system", content: "You are a reviewer." },
      { role: "user", content: "Review this" },
    ];
    for await (const _ of provider.chatStream(msgs, [])) { /* drain */ }

    const callArgs = mockClient.messages.stream.mock.calls[0][0] as {
      system?: string;
      messages: object[];
    };
    expect(callArgs.system).toBe("You are a reviewer.");
    // System message must not appear in the messages array
    expect(callArgs.messages.every((m: object) => (m as { role: string }).role !== "system")).toBe(true);
  });

  it("respects model override from options", async () => {
    const events = [
      { type: "message_delta", delta: { stop_reason: "end_turn" } },
      { type: "message_stop" },
    ];

    const mockClient = {
      messages: { stream: vi.fn().mockReturnValue(mockStream(events)) },
    };

    const provider = new AnthropicProvider(makeConfig(), mockClient as never);
    for await (const _ of provider.chatStream(
      [{ role: "user", content: "hi" }],
      [],
      { model: "claude-3-opus-20240229" },
    )) { /* drain */ }

    const callArgs = mockClient.messages.stream.mock.calls[0][0] as { model: string };
    expect(callArgs.model).toBe("claude-3-opus-20240229");
  });

  it("yields truncation text and stopReason 'length' on max_tokens", async () => {
    const events = [
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "partial" } },
      { type: "message_delta", delta: { stop_reason: "max_tokens" } },
      { type: "message_stop" },
    ];

    const mockClient = {
      messages: { stream: vi.fn().mockReturnValue(mockStream(events)) },
    };

    const provider = new AnthropicProvider(makeConfig(), mockClient as never);
    const collected: object[] = [];
    for await (const event of provider.chatStream(
      [{ role: "user", content: "write a lot" }],
      [],
    )) {
      collected.push(event);
    }

    const textEvents = collected.filter((e) => (e as { type: string }).type === "text");
    const doneEvent = collected.find((e) => (e as { type: string }).type === "done") as { stopReason: string } | undefined;
    expect(textEvents.some((e) => (e as { content: string }).content.includes("truncated"))).toBe(true);
    expect(doneEvent?.stopReason).toBe("length");
  });

  it("emits both tools in a single tool_calls event for multi-tool responses", async () => {
    const events = [
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "tc1", name: "file_read" },
      },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"path":"a.ts"}' } },
      { type: "content_block_stop", index: 0 },
      {
        type: "content_block_start",
        index: 1,
        content_block: { type: "tool_use", id: "tc2", name: "file_read" },
      },
      { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"path":"b.ts"}' } },
      { type: "content_block_stop", index: 1 },
      { type: "message_delta", delta: { stop_reason: "tool_use" } },
      { type: "message_stop" },
    ];

    const mockClient = {
      messages: { stream: vi.fn().mockReturnValue(mockStream(events)) },
    };

    const provider = new AnthropicProvider(makeConfig(), mockClient as never);
    const toolEvents: Array<{ calls: object[] }> = [];
    for await (const event of provider.chatStream(
      [{ role: "user", content: "read both files" }],
      [],
    )) {
      if (event.type === "tool_calls") toolEvents.push(event as { calls: object[] });
    }

    // Must be exactly ONE tool_calls event containing BOTH tools
    expect(toolEvents).toHaveLength(1);
    expect(toolEvents[0].calls).toHaveLength(2);
    expect((toolEvents[0].calls[0] as { name: string }).name).toBe("file_read");
    expect((toolEvents[0].calls[1] as { name: string }).name).toBe("file_read");
    expect((toolEvents[0].calls[0] as { id: string }).id).toBe("tc1");
    expect((toolEvents[0].calls[1] as { id: string }).id).toBe("tc2");
  });
});

// ---------------------------------------------------------------------------
// AnthropicProvider — AbortSignal propagation
// ---------------------------------------------------------------------------

describe("AnthropicProvider — AbortSignal cancellation", () => {
  it("passes signal as second argument to messages.stream() when provided", async () => {
    const events = [
      { type: "message_delta", delta: { stop_reason: "end_turn" } },
      { type: "message_stop" },
    ];

    const mockClient = {
      messages: { stream: vi.fn().mockReturnValue(mockStream(events)) },
    };

    const provider = new AnthropicProvider(makeConfig(), mockClient as never);
    const controller = new AbortController();

    for await (const _ of provider.chatStream(
      [{ role: "user", content: "hi" }],
      [],
      { signal: controller.signal },
    )) { /* drain */ }

    // Second argument to messages.stream() must include the signal
    expect(mockClient.messages.stream).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it("does not pass signal options when no signal is provided", async () => {
    const events = [
      { type: "message_delta", delta: { stop_reason: "end_turn" } },
      { type: "message_stop" },
    ];

    const mockClient = {
      messages: { stream: vi.fn().mockReturnValue(mockStream(events)) },
    };

    const provider = new AnthropicProvider(makeConfig(), mockClient as never);

    for await (const _ of provider.chatStream(
      [{ role: "user", content: "hi" }],
      [],
    )) { /* drain */ }

    // Without a signal, messages.stream() second arg must be undefined
    expect(mockClient.messages.stream).toHaveBeenCalledWith(
      expect.any(Object),
      undefined,
    );
  });
});

// ---------------------------------------------------------------------------
// Rate limit + auto-backoff (Sprint 58)
// ---------------------------------------------------------------------------

describe("AnthropicProvider rate limit handling", () => {
  let sleepSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    sleepSpy = vi.spyOn(openaiModule, "sleep").mockResolvedValue(undefined);
  });
  afterEach(() => {
    sleepSpy.mockRestore();
  });

  function make429Error(retryAfterSec?: number): Anthropic.APIError {
    const headers = new Headers();
    if (retryAfterSec !== undefined) {
      headers.set("retry-after", String(retryAfterSec));
    }
    return new Anthropic.APIError(429, { error: "rate_limit_error" }, "Too many requests", headers);
  }

  it("yields rate_limited on HTTP 429 when retryAfter > threshold", async () => {
    const err = make429Error(120);
    const mockClient = {
      messages: {
        stream: vi.fn().mockImplementation(() => {
          // Return an async iterable that throws immediately
          return {
            async *[Symbol.asyncIterator]() {
              throw err;
            },
          };
        }),
      },
    };

    const provider = new AnthropicProvider(makeConfig({ rate_limit_backoff_threshold: 60 }), mockClient as never);
    const events: object[] = [];
    for await (const event of provider.chatStream([{ role: "user", content: "hi" }], [])) {
      events.push(event);
    }

    expect(events).toContainEqual({ type: "rate_limited", retryAfter: 120 });
    expect(sleepSpy).not.toHaveBeenCalled();
  });

  it("auto-backoff: sleeps and retries when retryAfter <= threshold", async () => {
    const err = make429Error(5);
    const successEvents = [
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hi" } },
      { type: "message_stop" },
    ];
    let callCount = 0;
    const mockClient = {
      messages: {
        stream: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            return {
              async *[Symbol.asyncIterator]() {
                throw err;
              },
            };
          }
          return mockStream(successEvents);
        }),
      },
    };

    const provider = new AnthropicProvider(makeConfig({ rate_limit_backoff_threshold: 60 }), mockClient as never);
    const events: object[] = [];
    for await (const event of provider.chatStream([{ role: "user", content: "hi" }], [])) {
      events.push(event);
    }

    expect(events.some((e) => (e as { type: string }).type === "rate_limited")).toBe(false);
    expect(events).toContainEqual({ type: "text", content: "hi" });
    expect(sleepSpy).toHaveBeenCalledOnce();
    expect(sleepSpy).toHaveBeenCalledWith(5000);
    expect(callCount).toBe(2);
  });

  it("auto-backoff: max retries exhausted → yields rate_limited", async () => {
    // All calls throw 429 with retry-after: 5 (≤ threshold=60).
    // After MAX_RATE_LIMIT_RETRIES attempts, provider yields rate_limited.
    const { MAX_RATE_LIMIT_RETRIES } = await import("../../src/providers/openai.js");
    const err = make429Error(5);
    const mockClient = {
      messages: {
        stream: vi.fn().mockImplementation(() => ({
          async *[Symbol.asyncIterator]() {
            throw err;
          },
        })),
      },
    };

    const provider = new AnthropicProvider(makeConfig({ rate_limit_backoff_threshold: 60 }), mockClient as never);
    const events: object[] = [];
    for await (const event of provider.chatStream([{ role: "user", content: "hi" }], [])) {
      events.push(event);
    }

    expect(events).toContainEqual({ type: "rate_limited", retryAfter: 5 });
    expect(sleepSpy).toHaveBeenCalledTimes(MAX_RATE_LIMIT_RETRIES - 1);
  });

  it("auto-backoff: threshold=0 disables backoff → yields rate_limited immediately", async () => {
    const err = make429Error(5);
    const mockClient = {
      messages: {
        stream: vi.fn().mockImplementation(() => ({
          async *[Symbol.asyncIterator]() {
            throw err;
          },
        })),
      },
    };

    const provider = new AnthropicProvider(makeConfig({ rate_limit_backoff_threshold: 0 }), mockClient as never);
    const events: object[] = [];
    for await (const event of provider.chatStream([{ role: "user", content: "hi" }], [])) {
      events.push(event);
    }

    expect(events).toContainEqual({ type: "rate_limited", retryAfter: 5 });
    expect(sleepSpy).not.toHaveBeenCalled();
  });

  it("429 with no Retry-After header → yields rate_limited with retryAfter: undefined", async () => {
    const err = make429Error(); // no retryAfterSec → no header
    const mockClient = {
      messages: {
        stream: vi.fn().mockImplementation(() => ({
          async *[Symbol.asyncIterator]() {
            throw err;
          },
        })),
      },
    };

    const provider = new AnthropicProvider(makeConfig({ rate_limit_backoff_threshold: 60 }), mockClient as never);
    const events: object[] = [];
    for await (const event of provider.chatStream([{ role: "user", content: "hi" }], [])) {
      events.push(event);
    }

    expect(events).toContainEqual({ type: "rate_limited", retryAfter: undefined });
  });
});
