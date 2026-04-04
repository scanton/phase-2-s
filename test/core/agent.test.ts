/**
 * Agent integration tests.
 *
 * Tests the full agent loop using a streaming OpenAI client stub (OpenAIClientLike)
 * injected via AgentOptions.provider. No real API key required — all LLM responses
 * are mocked as AsyncIterable<ChatCompletionChunk> sequences. Uses a minimal
 * in-memory ToolRegistry with simple stub tools to avoid filesystem side effects.
 *
 * Since Sprint 4, the Provider interface uses chatStream() (AsyncIterable<ProviderEvent>)
 * instead of chat(). The fake client stubs create() to return an async iterable of
 * ChatCompletionChunk arrays — one sequence per call, consumed in order.
 */
import { describe, it, expect, vi } from "vitest";
import type { ChatCompletionChunk } from "openai/resources/chat/completions.js";
import { Agent } from "../../src/core/agent.js";
import { OpenAIProvider, type OpenAIClientLike } from "../../src/providers/openai.js";
import { ToolRegistry } from "../../src/tools/index.js";
import type { Config } from "../../src/core/config.js";
import { z } from "zod";

// --- Helpers ---

const minimalConfig: Config = {
  provider: "openai-api",
  model: "gpt-4o",
  apiKey: "sk-test",
  codexPath: "codex",
  maxTurns: 5,
  timeout: 120_000,
  allowDestructive: false,
};

/**
 * Build a fake OpenAI streaming client from an array of chunk sequences.
 * Each call to create() pops the next chunk sequence and returns it as an
 * async iterable. This replaces the old non-streaming makeFakeClient.
 */
function makeStreamingFakeClient(chunkSequences: ChatCompletionChunk[][]): OpenAIClientLike {
  let callIndex = 0;
  return {
    chat: {
      completions: {
        create: vi.fn().mockImplementation(() => {
          const chunks = chunkSequences[callIndex++] ?? [];
          return Promise.resolve(
            (async function* () {
              for (const chunk of chunks) {
                yield chunk;
              }
            })() as AsyncIterable<ChatCompletionChunk>,
          );
        }),
      },
    },
  };
}

/**
 * Collect all events from a provider's chatStream() into an array.
 * Useful for assertions on what the provider emitted.
 */
async function collectStream(provider: OpenAIProvider, messages: unknown[], tools: unknown[]) {
  const events = [];
  for await (const event of provider.chatStream(messages as never, tools as never)) {
    events.push(event);
  }
  return events;
}

// --- Chunk builders ---

/**
 * Build a minimal chunk sequence for a plain text response:
 * one content delta chunk + one done chunk with finish_reason.
 */
function makeTextChunks(text: string, finishReason = "stop"): ChatCompletionChunk[] {
  const base = {
    id: "chatcmpl-test",
    object: "chat.completion.chunk" as const,
    created: 1234567890,
    model: "gpt-4o",
    choices: [] as ChatCompletionChunk["choices"],
  };
  return [
    {
      ...base,
      choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null, logprobs: null }],
    },
    {
      ...base,
      choices: [{ index: 0, delta: {}, finish_reason: finishReason as ChatCompletionChunk["choices"][0]["finish_reason"], logprobs: null }],
    },
  ];
}

/**
 * Build a chunk sequence for a tool call response:
 * first chunk sets the tool call id and name, second sends args, third sets finish_reason.
 */
function makeToolCallChunks(toolName: string, args: Record<string, unknown>): ChatCompletionChunk[] {
  const argsStr = JSON.stringify(args);
  const base = {
    id: "chatcmpl-test",
    object: "chat.completion.chunk" as const,
    created: 1234567890,
    model: "gpt-4o",
  };
  return [
    {
      ...base,
      choices: [{
        index: 0,
        delta: {
          role: "assistant",
          content: null,
          tool_calls: [{ index: 0, id: "call_abc123", type: "function" as const, function: { name: toolName, arguments: "" } }],
        },
        finish_reason: null,
        logprobs: null,
      }],
    },
    {
      ...base,
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{ index: 0, function: { arguments: argsStr } }],
        },
        finish_reason: null,
        logprobs: null,
      }],
    },
    {
      ...base,
      choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" as const, logprobs: null }],
    },
  ];
}

/**
 * Build a minimal stub ToolRegistry with one echo tool that returns a fixed string.
 */
function makeStubRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register({
    name: "echo",
    description: "Returns the input text",
    parameters: z.object({ text: z.string() }),
    async execute(args: unknown) {
      const parsed = args as { text: string };
      return { success: true, output: `echo: ${parsed.text}` };
    },
  });
  registry.register({
    name: "fail_tool",
    description: "Always returns an error",
    parameters: z.object({ reason: z.string().optional() }),
    async execute(_args: unknown) {
      return { success: false, output: "", error: "boom" };
    },
  });
  return registry;
}

// --- Tests ---

describe("Agent integration", () => {
  it("returns text directly when LLM responds with no tool calls (finish_reason: stop)", async () => {
    const fakeClient = makeStreamingFakeClient([makeTextChunks("Hello from the LLM!")]);
    const provider = new OpenAIProvider(minimalConfig, fakeClient);

    const agent = new Agent({
      config: minimalConfig,
      provider,
      tools: makeStubRegistry(),
      systemPrompt: "You are a test assistant.",
    });

    const result = await agent.run("Say hello");
    expect(result).toBe("Hello from the LLM!");
    expect(fakeClient.chat.completions.create).toHaveBeenCalledTimes(1);
  });

  it("executes a single tool call and returns the final LLM response (2 API calls)", async () => {
    const fakeClient = makeStreamingFakeClient([
      makeToolCallChunks("echo", { text: "world" }),
      makeTextChunks("The echo tool returned: echo: world"),
    ]);
    const provider = new OpenAIProvider(minimalConfig, fakeClient);

    const agent = new Agent({
      config: minimalConfig,
      provider,
      tools: makeStubRegistry(),
      systemPrompt: "You are a test assistant.",
    });

    const result = await agent.run("Use the echo tool");
    expect(result).toBe("The echo tool returned: echo: world");
    expect(fakeClient.chat.completions.create).toHaveBeenCalledTimes(2);
  });

  it("handles multi-turn tool calls (2 tool calls across 2 turns, 3 API calls total)", async () => {
    const fakeClient = makeStreamingFakeClient([
      makeToolCallChunks("echo", { text: "first" }),
      makeToolCallChunks("echo", { text: "second" }),
      makeTextChunks("Done after two tool calls"),
    ]);
    const provider = new OpenAIProvider(minimalConfig, fakeClient);

    const agent = new Agent({
      config: minimalConfig,
      provider,
      tools: makeStubRegistry(),
      systemPrompt: "You are a test assistant.",
    });

    const result = await agent.run("Use echo twice");
    expect(result).toBe("Done after two tool calls");
    expect(fakeClient.chat.completions.create).toHaveBeenCalledTimes(3);
  });

  it("passes tool error (success: false) back to LLM as tool result and continues", async () => {
    const fakeClient = makeStreamingFakeClient([
      makeToolCallChunks("fail_tool", { reason: "test" }),
      makeTextChunks("I see the tool failed with: boom"),
    ]);
    const provider = new OpenAIProvider(minimalConfig, fakeClient);

    const agent = new Agent({
      config: minimalConfig,
      provider,
      tools: makeStubRegistry(),
      systemPrompt: "You are a test assistant.",
    });

    const result = await agent.run("Try the fail tool");
    // Agent should NOT abort — it passes the error string to the LLM and continues
    expect(result).toBe("I see the tool failed with: boom");
    expect(fakeClient.chat.completions.create).toHaveBeenCalledTimes(2);
  });

  it("returns max-turns sentinel when LLM keeps calling tools indefinitely", async () => {
    // All responses are tool calls — the agent never gets a terminal text response
    const infiniteResponses = Array.from({ length: 10 }, () =>
      makeToolCallChunks("echo", { text: "loop" })
    );
    const fakeClient = makeStreamingFakeClient(infiniteResponses);
    const provider = new OpenAIProvider(minimalConfig, fakeClient);

    const agent = new Agent({
      config: { ...minimalConfig, maxTurns: 3 },
      provider,
      tools: makeStubRegistry(),
      systemPrompt: "You are a test assistant.",
    });

    const result = await agent.run("Keep calling tools");
    expect(result).toMatch(/Agent reached maximum turns/);
    // Should have stopped at maxTurns (3), not run indefinitely
    expect(fakeClient.chat.completions.create).toHaveBeenCalledTimes(3);
  });

  it("handles finish_reason: length by returning partial text with truncation notice", async () => {
    const fakeClient = makeStreamingFakeClient([
      makeTextChunks("Partial response here...", "length"),
    ]);
    const provider = new OpenAIProvider(minimalConfig, fakeClient);

    const agent = new Agent({
      config: minimalConfig,
      provider,
      tools: makeStubRegistry(),
      systemPrompt: "You are a test assistant.",
    });

    const result = await agent.run("Tell me something long");
    // Should return partial text + truncation notice, NOT crash, NOT re-query
    expect(result).toContain("Partial response here...");
    expect(result).toContain("[Note: response was truncated]");
    expect(fakeClient.chat.completions.create).toHaveBeenCalledTimes(1);
  });

  it("handles finish_reason: content_filter by returning blocked sentinel", async () => {
    // content_filter: final chunk has finish_reason but no content delta
    const contentFilterChunks: ChatCompletionChunk[] = [
      {
        id: "chatcmpl-test",
        object: "chat.completion.chunk",
        created: 1234567890,
        model: "gpt-4o",
        choices: [{ index: 0, delta: {}, finish_reason: "content_filter", logprobs: null }],
      },
    ];
    const fakeClient = makeStreamingFakeClient([contentFilterChunks]);
    const provider = new OpenAIProvider(minimalConfig, fakeClient);

    const agent = new Agent({
      config: minimalConfig,
      provider,
      tools: makeStubRegistry(),
      systemPrompt: "You are a test assistant.",
    });

    const result = await agent.run("Say something problematic");
    expect(result).toBe("[Response blocked by content filter]");
    expect(fakeClient.chat.completions.create).toHaveBeenCalledTimes(1);
  });

  it("handles malformed JSON tool arguments by sending error to LLM and continuing", async () => {
    // Tool call with bad JSON args — sent as raw string through the accumulator
    const badArgsChunks: ChatCompletionChunk[] = [
      {
        id: "chatcmpl-test",
        object: "chat.completion.chunk",
        created: 1234567890,
        model: "gpt-4o",
        choices: [{
          index: 0,
          delta: {
            role: "assistant",
            content: null,
            tool_calls: [{ index: 0, id: "call_bad", type: "function", function: { name: "echo", arguments: "" } }],
          },
          finish_reason: null,
          logprobs: null,
        }],
      },
      {
        id: "chatcmpl-test",
        object: "chat.completion.chunk",
        created: 1234567890,
        model: "gpt-4o",
        choices: [{
          index: 0,
          delta: { tool_calls: [{ index: 0, function: { arguments: "not-valid-json" } }] },
          finish_reason: null,
          logprobs: null,
        }],
      },
      {
        id: "chatcmpl-test",
        object: "chat.completion.chunk",
        created: 1234567890,
        model: "gpt-4o",
        choices: [{ index: 0, delta: {}, finish_reason: "tool_calls", logprobs: null }],
      },
    ];

    const fakeClient = makeStreamingFakeClient([
      badArgsChunks,
      makeTextChunks("I see there was a JSON error"),
    ]);
    const provider = new OpenAIProvider(minimalConfig, fakeClient);

    const agent = new Agent({
      config: minimalConfig,
      provider,
      tools: makeStubRegistry(),
      systemPrompt: "You are a test assistant.",
    });

    // Agent should NOT crash — it sends "Error: Invalid JSON arguments" as tool result
    const result = await agent.run("Call echo with bad args");
    expect(result).toBe("I see there was a JSON error");
    expect(fakeClient.chat.completions.create).toHaveBeenCalledTimes(2);
  });

  // --- New streaming-specific tests ---

  it("fires onDelta callback with each text chunk in order", async () => {
    // Split text across 3 content chunks to verify delta streaming
    const multiChunkChunks: ChatCompletionChunk[] = [
      { id: "x", object: "chat.completion.chunk", created: 0, model: "gpt-4o", choices: [{ index: 0, delta: { role: "assistant", content: "Hello" }, finish_reason: null, logprobs: null }] },
      { id: "x", object: "chat.completion.chunk", created: 0, model: "gpt-4o", choices: [{ index: 0, delta: { content: " world" }, finish_reason: null, logprobs: null }] },
      { id: "x", object: "chat.completion.chunk", created: 0, model: "gpt-4o", choices: [{ index: 0, delta: { content: "!" }, finish_reason: null, logprobs: null }] },
      { id: "x", object: "chat.completion.chunk", created: 0, model: "gpt-4o", choices: [{ index: 0, delta: {}, finish_reason: "stop", logprobs: null }] },
    ];

    const fakeClient = makeStreamingFakeClient([multiChunkChunks]);
    const provider = new OpenAIProvider(minimalConfig, fakeClient);
    const agent = new Agent({ config: minimalConfig, provider, tools: makeStubRegistry() });

    const deltas: string[] = [];
    const result = await agent.run("Say hello world", (chunk) => deltas.push(chunk));

    expect(result).toBe("Hello world!");
    expect(deltas).toEqual(["Hello", " world", "!"]);
    expect(deltas.length).toBeGreaterThan(1); // actually streamed, not just one blob
  });

  it("accumulates tool call fragments across multiple chunks correctly", async () => {
    // Simulate OpenAI splitting tool call arguments across 3 chunks
    const splitArgsChunks: ChatCompletionChunk[] = [
      {
        id: "x", object: "chat.completion.chunk", created: 0, model: "gpt-4o",
        choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "echo", arguments: "" } }] }, finish_reason: null, logprobs: null }],
      },
      {
        id: "x", object: "chat.completion.chunk", created: 0, model: "gpt-4o",
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"tex' } }] }, finish_reason: null, logprobs: null }],
      },
      {
        id: "x", object: "chat.completion.chunk", created: 0, model: "gpt-4o",
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: 't":"hi"}' } }] }, finish_reason: null, logprobs: null }],
      },
      {
        id: "x", object: "chat.completion.chunk", created: 0, model: "gpt-4o",
        choices: [{ index: 0, delta: {}, finish_reason: "tool_calls", logprobs: null }],
      },
    ];

    const fakeClient = makeStreamingFakeClient([
      splitArgsChunks,
      makeTextChunks("echo: hi"),
    ]);
    const provider = new OpenAIProvider(minimalConfig, fakeClient);
    const agent = new Agent({ config: minimalConfig, provider, tools: makeStubRegistry() });

    const result = await agent.run("Call echo with hi");
    expect(result).toBe("echo: hi");
  });

  it("OpenAIProvider chatStream() emits correct event sequence for text response", async () => {
    const fakeClient = makeStreamingFakeClient([makeTextChunks("test response")]);
    const provider = new OpenAIProvider(minimalConfig, fakeClient);

    const events = await collectStream(provider, [{ role: "user", content: "hi" }], []);
    expect(events[0]).toEqual({ type: "text", content: "test response" });
    expect(events[events.length - 1]).toMatchObject({ type: "done" });
  });

  it("Codex provider chatStream() emits text + done from batch _chat() result", async () => {
    // Test the Codex passthrough wrapper by using the CodexProvider with a mocked _chat
    const { CodexProvider } = await import("../../src/providers/codex.js");
    const provider = new CodexProvider(minimalConfig);

    // Patch the private _chat method for testing
    (provider as unknown as { _chat: unknown })._chat = vi.fn().mockResolvedValue({
      text: "Codex says hello",
      toolCalls: [],
    });

    const events = await collectStream(provider as unknown as OpenAIProvider, [], []);
    expect(events).toEqual([
      { type: "text", content: "Codex says hello" },
      { type: "done", stopReason: "stop" },
    ]);
  });
});
