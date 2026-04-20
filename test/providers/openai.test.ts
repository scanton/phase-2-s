/**
 * Tests for OpenAIProvider.
 *
 * Uses constructor injection (OpenAIClientLike mock) rather than vi.mock("openai")
 * module mocking. The OpenAIProvider constructor accepts an optional `client`
 * parameter — we pass a typed stub directly, same pattern as anthropic.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import OpenAI from "openai";
import { OpenAIProvider, type OpenAIClientLike, MAX_RATE_LIMIT_RETRIES, parseRetryAfter } from "../../src/providers/openai.js";
import * as openaiModule from "../../src/providers/openai.js";
import type { Message } from "../../src/providers/types.js";
import type { Config } from "../../src/core/config.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    provider: "openai-api",
    model: "gpt-4o",
    apiKey: "test-key",
    anthropicApiKey: undefined,
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
 * Build a mock OpenAIClientLike that streams the given chunks.
 * The create() method returns an AsyncIterable over the provided chunks.
 */
function mockClientWithChunks(chunks: object[]): { client: OpenAIClientLike; mockCreate: ReturnType<typeof vi.fn> } {
  const stream: AsyncIterable<object> = {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    },
  };
  const mockCreate = vi.fn().mockResolvedValue(stream);
  const client: OpenAIClientLike = {
    chat: { completions: { create: mockCreate } },
  };
  return { client, mockCreate };
}

/** Collect all events from a chatStream call into an array. */
async function collectEvents(
  provider: OpenAIProvider,
  messages: Message[],
  options?: Parameters<OpenAIProvider["chatStream"]>[2],
) {
  const events: object[] = [];
  for await (const event of provider.chatStream(messages, [], options)) {
    events.push(event);
  }
  return events;
}

/** Build a minimal text chunk (OpenAI streaming format). */
function textChunk(content: string, finishReason: string | null = null) {
  return {
    choices: [
      {
        delta: { content, tool_calls: undefined },
        finish_reason: finishReason,
      },
    ],
  };
}

/** Build a tool-call chunk for a given index (first chunk: id+name, subsequent: args). */
function toolCallChunk(index: number, id?: string, name?: string, args?: string) {
  return {
    choices: [
      {
        delta: {
          content: null,
          tool_calls: [
            {
              index,
              ...(id !== undefined ? { id } : {}),
              ...(name !== undefined || args !== undefined
                ? {
                    function: {
                      ...(name !== undefined ? { name } : {}),
                      ...(args !== undefined ? { arguments: args } : {}),
                    },
                  }
                : {}),
            },
          ],
        },
        finish_reason: null,
      },
    ],
  };
}

/** Final empty chunk with finish_reason. */
function doneChunk(finishReason = "stop") {
  return {
    choices: [
      {
        delta: { content: null },
        finish_reason: finishReason,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------

describe("OpenAIProvider constructor", () => {
  it("throws if no api key and no injected client", () => {
    expect(() => new OpenAIProvider(makeConfig({ apiKey: undefined }))).toThrow(
      /OpenAI API key is required/,
    );
  });

  it("does not throw when api key is provided", () => {
    expect(() => new OpenAIProvider(makeConfig({ apiKey: "sk-test" }))).not.toThrow();
  });

  it("does not throw when mock client is injected (no api key needed)", () => {
    const { client } = mockClientWithChunks([]);
    expect(() => new OpenAIProvider(makeConfig({ apiKey: undefined }), client)).not.toThrow();
  });

  it("uses model from config", async () => {
    const { client, mockCreate } = mockClientWithChunks([doneChunk()]);
    const provider = new OpenAIProvider(makeConfig({ model: "gpt-4-turbo" }), client);
    await collectEvents(provider, [{ role: "user", content: "hi" }]);
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-4-turbo" }));
  });

  it("modelOverride in options overrides the config model", async () => {
    const { client, mockCreate } = mockClientWithChunks([doneChunk()]);
    const provider = new OpenAIProvider(makeConfig({ model: "gpt-4o" }), client);
    await collectEvents(provider, [{ role: "user", content: "hi" }], { model: "gpt-4o-mini" });
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-4o-mini" }));
  });
});

// ---------------------------------------------------------------------------
// chatStream — text events
// ---------------------------------------------------------------------------

describe("OpenAIProvider.chatStream — text", () => {
  it("yields text events from streaming chunks", async () => {
    const chunks = [
      textChunk("Hello"),
      textChunk(", world"),
      doneChunk(),
    ];
    const { client } = mockClientWithChunks(chunks);
    const provider = new OpenAIProvider(makeConfig(), client);
    const events = await collectEvents(provider, [{ role: "user", content: "hi" }]);
    const textEvents = events.filter((e) => (e as { type: string }).type === "text");
    expect(textEvents).toHaveLength(2);
    expect((textEvents[0] as { content: string }).content).toBe("Hello");
    expect((textEvents[1] as { content: string }).content).toBe(", world");
  });

  it("yields done event after stream completes", async () => {
    const chunks = [textChunk("ok"), doneChunk("stop")];
    const { client } = mockClientWithChunks(chunks);
    const provider = new OpenAIProvider(makeConfig(), client);
    const events = await collectEvents(provider, [{ role: "user", content: "hi" }]);
    const doneEvents = events.filter((e) => (e as { type: string }).type === "done");
    expect(doneEvents).toHaveLength(1);
    expect((doneEvents[0] as { stopReason: string }).stopReason).toBe("stop");
  });

  it("handles empty message list gracefully", async () => {
    const { client } = mockClientWithChunks([doneChunk()]);
    const provider = new OpenAIProvider(makeConfig(), client);
    const events = await collectEvents(provider, []);
    expect(events.some((e) => (e as { type: string }).type === "done")).toBe(true);
  });

  it("passes system messages as role:system in the messages array", async () => {
    const { client, mockCreate } = mockClientWithChunks([doneChunk()]);
    const provider = new OpenAIProvider(makeConfig(), client);
    await collectEvents(provider, [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "hi" },
    ]);
    const call = mockCreate.mock.calls[0][0] as { messages: Array<{ role: string; content: string }> };
    expect(call.messages[0]).toEqual({ role: "system", content: "You are helpful." });
  });

  it("yields truncation note and done on finish_reason: length", async () => {
    const { client } = mockClientWithChunks([textChunk("partial", "length")]);
    const provider = new OpenAIProvider(makeConfig(), client);
    const events = await collectEvents(provider, [{ role: "user", content: "hi" }]);
    const textEvents = events.filter((e) => (e as { type: string }).type === "text");
    const truncated = textEvents.some((e) => (e as { content: string }).content.includes("truncated"));
    expect(truncated).toBe(true);
    const doneEvents = events.filter((e) => (e as { type: string }).type === "done");
    expect((doneEvents[0] as { stopReason: string }).stopReason).toBe("length");
  });
});

// ---------------------------------------------------------------------------
// chatStream — tool calls
// ---------------------------------------------------------------------------

describe("OpenAIProvider.chatStream — tool calls", () => {
  it("accumulates and emits tool_calls after stream ends", async () => {
    const chunks = [
      toolCallChunk(0, "call-1", "file_read"),
      toolCallChunk(0, undefined, undefined, '{"path":'),
      toolCallChunk(0, undefined, undefined, '"foo.ts"}'),
      doneChunk("tool_calls"),
    ];
    const { client } = mockClientWithChunks(chunks);
    const provider = new OpenAIProvider(makeConfig(), client);
    const events = await collectEvents(provider, [{ role: "user", content: "read the file" }], undefined);
    const tcEvents = events.filter((e) => (e as { type: string }).type === "tool_calls");
    expect(tcEvents).toHaveLength(1);
    const tc = tcEvents[0] as { type: string; calls: Array<{ id: string; name: string; arguments: string }> };
    expect(tc.calls).toHaveLength(1);
    expect(tc.calls[0].id).toBe("call-1");
    expect(tc.calls[0].name).toBe("file_read");
    expect(tc.calls[0].arguments).toBe('{"path":"foo.ts"}');
  });

  it("accumulates multiple parallel tool calls by index", async () => {
    const chunks = [
      toolCallChunk(0, "call-0", "tool_a"),
      toolCallChunk(1, "call-1", "tool_b"),
      toolCallChunk(0, undefined, undefined, '{"a":1}'),
      toolCallChunk(1, undefined, undefined, '{"b":2}'),
      doneChunk("tool_calls"),
    ];
    const { client } = mockClientWithChunks(chunks);
    const provider = new OpenAIProvider(makeConfig(), client);
    const events = await collectEvents(provider, [{ role: "user", content: "do both" }]);
    const tcEvents = events.filter((e) => (e as { type: string }).type === "tool_calls");
    expect(tcEvents).toHaveLength(1);
    const calls = (tcEvents[0] as { calls: Array<{ id: string; name: string }> }).calls;
    expect(calls).toHaveLength(2);
    expect(calls[0].name).toBe("tool_a");
    expect(calls[1].name).toBe("tool_b");
  });
});

// ---------------------------------------------------------------------------
// chatStream — AbortSignal
// ---------------------------------------------------------------------------

describe("OpenAIProvider.chatStream — abort signal", () => {
  it("aborts cleanly when signal fires mid-stream and yields done (not error)", async () => {
    const controller = new AbortController();

    // Stream that calls abort partway through
    const stream: AsyncIterable<object> = {
      async *[Symbol.asyncIterator]() {
        yield textChunk("Hello");
        // Simulate abort mid-stream by throwing the SDK abort error
        controller.abort();
        const err = new Error("Request was aborted.");
        throw err;
      },
    };
    const mockCreate = vi.fn().mockResolvedValue(stream);
    const client: OpenAIClientLike = { chat: { completions: { create: mockCreate } } };

    const provider = new OpenAIProvider(makeConfig(), client);
    const events: object[] = [];
    let thrown = false;
    try {
      for await (const event of provider.chatStream(
        [{ role: "user", content: "hi" }],
        [],
        { signal: controller.signal },
      )) {
        events.push(event);
      }
    } catch {
      thrown = true;
    }
    expect(thrown).toBe(false);
    const doneEvents = events.filter((e) => (e as { type: string }).type === "done");
    expect(doneEvents).toHaveLength(1);
  });

  it("passes signal to the SDK create call", async () => {
    const controller = new AbortController();
    const { client, mockCreate } = mockClientWithChunks([doneChunk()]);
    const provider = new OpenAIProvider(makeConfig(), client);
    await collectEvents(provider, [{ role: "user", content: "hi" }], { signal: controller.signal });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it("throws on API error (not an abort)", async () => {
    const stream: AsyncIterable<object> = {
      async *[Symbol.asyncIterator]() {
        throw new Error("400 Bad Request");
      },
    };
    const mockCreate = vi.fn().mockResolvedValue(stream);
    const client: OpenAIClientLike = { chat: { completions: { create: mockCreate } } };
    const provider = new OpenAIProvider(makeConfig(), client);
    await expect(async () => {
      await collectEvents(provider, [{ role: "user", content: "hi" }]);
    }).rejects.toThrow("400 Bad Request");
  });

  it("non-429 generic error still propagates as throw", async () => {
    const stream: AsyncIterable<object> = {
      async *[Symbol.asyncIterator]() {
        throw new Error("500 Internal Server Error");
      },
    };
    const mockCreate = vi.fn().mockResolvedValue(stream);
    const client: OpenAIClientLike = { chat: { completions: { create: mockCreate } } };
    const provider = new OpenAIProvider(makeConfig(), client);
    await expect(async () => {
      await collectEvents(provider, [{ role: "user", content: "hi" }]);
    }).rejects.toThrow("500 Internal Server Error");
  });
});

// ---------------------------------------------------------------------------
// Rate limit + auto-backoff (Sprint 58)
// ---------------------------------------------------------------------------

describe("OpenAIProvider rate limit and auto-backoff", () => {
  let sleepSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    sleepSpy = vi.spyOn(openaiModule, "sleep").mockResolvedValue(undefined);
  });
  afterEach(() => {
    sleepSpy.mockRestore();
  });

  /** Build a real OpenAI.APIError with status 429 and optional retry-after header. */
  function make429Error(retryAfterSec?: number): OpenAI.APIError {
    const headers: Record<string, string> = retryAfterSec !== undefined
      ? { "retry-after": String(retryAfterSec) }
      : {};
    return OpenAI.APIError.generate(429, null, "Too Many Requests", headers as unknown as Headers);
  }

  it("yields rate_limited event on HTTP 429 (no auto-backoff when retryAfter > threshold)", async () => {
    // retryAfter=120 > threshold=60 → no sleep, yield rate_limited immediately
    const err = make429Error(120);
    const mockCreate = vi.fn().mockRejectedValue(err);
    const client: OpenAIClientLike = { chat: { completions: { create: mockCreate } } };
    const provider = new OpenAIProvider(makeConfig({ rate_limit_backoff_threshold: 60 }), client);

    const events = await collectEvents(provider, [{ role: "user", content: "hi" }]);
    expect(events).toContainEqual({ type: "rate_limited", retryAfter: 120 });
    expect(sleepSpy).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("auto-backoff: sleeps and retries on short retryAfter, succeeds on retry", async () => {
    // First call → 429 with retry-after: 5; second call → success stream.
    // sleep() is an internal call in openai.ts (same-file), so vi.spyOn doesn't intercept it.
    // We use vi.useFakeTimers() to make setTimeout resolve immediately.
    vi.useFakeTimers();
    try {
      const err = make429Error(5);
      const successStream: AsyncIterable<object> = {
        async *[Symbol.asyncIterator]() {
          yield { choices: [{ delta: { content: "hello" }, finish_reason: null }] };
          yield { choices: [{ delta: {}, finish_reason: "stop" }] };
        },
      };
      const mockCreate = vi.fn()
        .mockRejectedValueOnce(err)
        .mockResolvedValueOnce(successStream);
      const client: OpenAIClientLike = { chat: { completions: { create: mockCreate } } };
      const provider = new OpenAIProvider(makeConfig({ rate_limit_backoff_threshold: 60 }), client);

      // Start the stream then flush all pending timers (the sleep) before awaiting.
      const eventsPromise = collectEvents(provider, [{ role: "user", content: "hi" }]);
      await vi.runAllTimersAsync();
      const events = await eventsPromise;

      // Should NOT see rate_limited — should see text + done from successful retry
      expect(events.some((e) => (e as { type: string }).type === "rate_limited")).toBe(false);
      expect(events).toContainEqual({ type: "text", content: "hello" });
      expect(events).toContainEqual({ type: "done", stopReason: "stop" });
      // Retry happened → create called twice
      expect(mockCreate).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("auto-backoff: max retries exhausted → yields rate_limited", async () => {
    // MAX_RATE_LIMIT_RETRIES = 3 → 4th call is the limit, should yield rate_limited.
    // Same fake-timer pattern to skip the backoff delays.
    vi.useFakeTimers();
    try {
      const err = make429Error(5);
      const mockCreate = vi.fn().mockRejectedValue(err);
      const client: OpenAIClientLike = { chat: { completions: { create: mockCreate } } };
      const provider = new OpenAIProvider(makeConfig({ rate_limit_backoff_threshold: 60 }), client);

      const eventsPromise = collectEvents(provider, [{ role: "user", content: "hi" }]);
      await vi.runAllTimersAsync();
      const events = await eventsPromise;

      expect(events).toContainEqual({ type: "rate_limited", retryAfter: 5 });
      // total create calls = MAX_RATE_LIMIT_RETRIES (first try + retries up to budget)
      expect(mockCreate).toHaveBeenCalledTimes(MAX_RATE_LIMIT_RETRIES);
    } finally {
      vi.useRealTimers();
    }
  });

  it("auto-backoff: threshold=0 disables backoff → yields rate_limited immediately", async () => {
    const err = make429Error(5);
    const mockCreate = vi.fn().mockRejectedValue(err);
    const client: OpenAIClientLike = { chat: { completions: { create: mockCreate } } };
    const provider = new OpenAIProvider(makeConfig({ rate_limit_backoff_threshold: 0 }), client);

    const events = await collectEvents(provider, [{ role: "user", content: "hi" }]);
    expect(events).toContainEqual({ type: "rate_limited", retryAfter: 5 });
    expect(sleepSpy).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("SIGINT abort is NOT treated as rate limit — does not yield rate_limited", async () => {
    // Aborted signal: the error should yield done (stop), not rate_limited
    const controller = new AbortController();
    controller.abort();
    const stream: AsyncIterable<object> = {
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { content: "hi" }, finish_reason: null }] };
      },
    };
    const mockCreate = vi.fn().mockResolvedValue(stream);
    const client: OpenAIClientLike = { chat: { completions: { create: mockCreate } } };
    const provider = new OpenAIProvider(makeConfig(), client);

    const events = await collectEvents(provider, [{ role: "user", content: "hi" }], {
      signal: controller.signal,
    });
    expect(events.every((e) => (e as { type: string }).type !== "rate_limited")).toBe(true);
  });

  it("429 with no Retry-After header → yields rate_limited with retryAfter: undefined", async () => {
    // make429Error with no argument produces headers without retry-after
    const headers: Record<string, string> = {};
    const err = OpenAI.APIError.generate(429, null, "Too Many Requests", headers as unknown as Headers);
    const mockCreate = vi.fn().mockRejectedValue(err);
    const client: OpenAIClientLike = { chat: { completions: { create: mockCreate } } };
    const provider = new OpenAIProvider(makeConfig({ rate_limit_backoff_threshold: 60 }), client);

    const events = await collectEvents(provider, [{ role: "user", content: "hi" }]);
    expect(events).toContainEqual({ type: "rate_limited", retryAfter: undefined });
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// parseRetryAfter — edge cases
// ---------------------------------------------------------------------------

describe("parseRetryAfter", () => {
  it("returns undefined for undefined input", () => {
    expect(parseRetryAfter(undefined)).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(parseRetryAfter("")).toBeUndefined();
  });

  it("parses integer-seconds form", () => {
    expect(parseRetryAfter("47")).toBe(47);
    expect(parseRetryAfter("0")).toBe(0);
    expect(parseRetryAfter("120")).toBe(120);
  });

  it("returns undefined for non-numeric, non-date string", () => {
    expect(parseRetryAfter("not-a-number")).toBeUndefined();
  });

  it("parses HTTP-date form — returns non-negative seconds until that date", () => {
    // A far-future date should return a positive number of seconds
    const futureDate = new Date(Date.now() + 60_000).toUTCString(); // 60s from now
    const result = parseRetryAfter(futureDate);
    expect(result).toBeDefined();
    expect(result!).toBeGreaterThan(0);
    expect(result!).toBeLessThanOrEqual(61); // allow 1s tolerance
  });

  it("parses HTTP-date form — past date returns 0 (not negative)", () => {
    const pastDate = new Date(Date.now() - 60_000).toUTCString(); // 60s ago
    const result = parseRetryAfter(pastDate);
    expect(result).toBe(0);
  });
});
