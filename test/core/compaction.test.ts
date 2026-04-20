/**
 * Tests for buildCompactionSummary (src/core/compaction.ts).
 *
 * The provider is mocked via a lightweight factory so we can control stream events
 * without touching the real providers. AbortController behavior is tested with
 * fake timers.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildCompactionSummary, COMPACT_SUMMARY_PROMPT } from "../../src/core/compaction.js";
import type { Provider, ProviderEvent, Message } from "../../src/providers/types.js";
import { RateLimitError } from "../../src/core/rate-limit-error.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type StreamEvent = ProviderEvent;

/**
 * Create a mock Provider whose chatStream() returns the given events in order.
 */
function makeProvider(events: StreamEvent[]): Provider {
  return {
    name: "mock",
    chatStream: vi.fn().mockReturnValue(
      (async function* () {
        for (const event of events) {
          yield event;
        }
      })(),
    ),
  };
}

/**
 * Create a mock Provider whose chatStream() rejects with the given error.
 */
function makeErrorProvider(message: string): Provider {
  return {
    name: "mock-error",
    chatStream: vi.fn().mockReturnValue(
      (async function* () {
        yield { type: "error", error: message } as ProviderEvent;
      })(),
    ),
  };
}

const SAMPLE_MESSAGES: Message[] = [
  { role: "user", content: "Hello" },
  { role: "assistant", content: "Hi there" },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildCompactionSummary", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("happy path: collects text events and returns joined summary", async () => {
    const provider = makeProvider([
      { type: "text", content: "Files modified: " },
      { type: "text", content: "src/index.ts" },
      { type: "done", stopReason: "stop" },
    ]);

    const resultPromise = buildCompactionSummary(provider, SAMPLE_MESSAGES);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toBe("Files modified: src/index.ts");
  });

  it("includes the compaction prompt as the last message passed to chatStream", async () => {
    const provider = makeProvider([{ type: "done", stopReason: "stop" }]);

    const resultPromise = buildCompactionSummary(provider, SAMPLE_MESSAGES);
    await vi.runAllTimersAsync();
    await resultPromise;

    expect(provider.chatStream).toHaveBeenCalledOnce();
    const [passedMessages] = (provider.chatStream as ReturnType<typeof vi.fn>).mock.calls[0];
    // Last message should be the compaction prompt
    const lastMsg = passedMessages[passedMessages.length - 1];
    expect(lastMsg.role).toBe("user");
    expect(lastMsg.content).toContain("Summarize this conversation");
    expect(lastMsg.content).toBe(COMPACT_SUMMARY_PROMPT);
  });

  it("preserves original messages — they are included before the compaction prompt", async () => {
    const provider = makeProvider([{ type: "done", stopReason: "stop" }]);

    const resultPromise = buildCompactionSummary(provider, SAMPLE_MESSAGES);
    await vi.runAllTimersAsync();
    await resultPromise;

    const [passedMessages] = (provider.chatStream as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(passedMessages.slice(0, SAMPLE_MESSAGES.length)).toEqual(SAMPLE_MESSAGES);
  });

  it("returns empty string when provider yields no text events", async () => {
    const provider = makeProvider([{ type: "done", stopReason: "stop" }]);

    const resultPromise = buildCompactionSummary(provider, SAMPLE_MESSAGES);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toBe("");
  });

  it("ignores tool_calls events (compaction never invokes tools)", async () => {
    const provider = makeProvider([
      { type: "tool_calls", calls: [{ id: "tc1", name: "shell", arguments: "{}" }] },
      { type: "text", content: "Summary text" },
      { type: "done", stopReason: "stop" },
    ]);

    const resultPromise = buildCompactionSummary(provider, SAMPLE_MESSAGES);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toBe("Summary text");
  });

  it("provider error event: throws with the error message", async () => {
    const provider = makeErrorProvider("rate limit exceeded");
    // Don't use vi.runAllTimersAsync() — error arrives via microtask before any timer fires.
    // Attaching .rejects immediately prevents the "unhandled rejection" warning.
    await expect(buildCompactionSummary(provider, SAMPLE_MESSAGES)).rejects.toThrow(
      "rate limit exceeded",
    );
  });

  it("passes AbortSignal to chatStream options", async () => {
    const provider = makeProvider([{ type: "done", stopReason: "stop" }]);

    const resultPromise = buildCompactionSummary(provider, SAMPLE_MESSAGES);
    await vi.runAllTimersAsync();
    await resultPromise;

    const [, , options] = (provider.chatStream as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(options).toHaveProperty("signal");
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("stream timeout: AbortSignal fires at 30 seconds and the stalled stream rejects", async () => {
    // Generator that stalls and listens to the AbortSignal to detect the timeout
    let capturedSignal: AbortSignal | undefined;
    const provider: Provider = {
      name: "mock-stall",
      chatStream: vi.fn().mockImplementation((_msgs, _tools, opts) => {
        capturedSignal = opts?.signal;
        return (async function* () {
          yield { type: "text", content: "partial..." } as ProviderEvent;
          // Wait until the AbortSignal fires (simulates a stalled HTTP response)
          await new Promise<void>((_, reject) => {
            capturedSignal!.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          });
        })();
      }),
    };

    const resultPromise = buildCompactionSummary(provider, SAMPLE_MESSAGES);
    // Attach error handler immediately — before any awaits — to prevent "unhandled rejection"
    const settled = resultPromise.catch((e: unknown) => ({ error: e }));

    // Signal should not be aborted yet
    expect(capturedSignal?.aborted).toBe(false);

    // Advance to just before 30s — signal still not aborted
    await vi.advanceTimersByTimeAsync(29_999);
    expect(capturedSignal?.aborted).toBe(false);

    // Advance past the 30s mark — AbortController fires, signal becomes aborted
    await vi.advanceTimersByTimeAsync(2);
    expect(capturedSignal?.aborted).toBe(true);

    // Await the settled result — should be an AbortError (stream threw on signal)
    const result = await settled;
    expect(result).toHaveProperty("error");
    expect((result as { error: unknown }).error).toBeInstanceOf(DOMException);
    expect(((result as { error: DOMException }).error).name).toBe("AbortError");
  });

  it("empty messages array: does not throw, returns summary from provider", async () => {
    const provider = makeProvider([
      { type: "text", content: "Empty session" },
      { type: "done", stopReason: "stop" },
    ]);

    const resultPromise = buildCompactionSummary(provider, []);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toBe("Empty session");
  });

  it("rate_limited event with retryAfter: throws RateLimitError with correct retryAfter", async () => {
    const provider = makeProvider([
      { type: "rate_limited", retryAfter: 47 },
    ]);

    await expect(buildCompactionSummary(provider, SAMPLE_MESSAGES)).rejects.toSatisfy(
      (e: unknown) => e instanceof RateLimitError && e.retryAfter === 47,
    );
  });

  it("rate_limited event without retryAfter: throws RateLimitError with undefined retryAfter", async () => {
    const provider = makeProvider([
      { type: "rate_limited" },
    ]);

    await expect(buildCompactionSummary(provider, SAMPLE_MESSAGES)).rejects.toSatisfy(
      (e: unknown) => e instanceof RateLimitError && e.retryAfter === undefined,
    );
  });

  it("partial text before rate_limited: throws RateLimitError (summary not returned)", async () => {
    const provider = makeProvider([
      { type: "text", content: "Partial summary..." },
      { type: "rate_limited", retryAfter: 30 },
    ]);

    await expect(buildCompactionSummary(provider, SAMPLE_MESSAGES)).rejects.toBeInstanceOf(RateLimitError);
  });
});
