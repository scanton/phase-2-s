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
import { describe, it, expect, vi, afterEach, type Mock } from "vitest";
import type { ChatCompletionChunk } from "openai/resources/chat/completions.js";
import { Agent } from "../../src/core/agent.js";
import { Conversation } from "../../src/core/conversation.js";
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
  verifyCommand: "npm test",
  requireSpecification: false,
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

  it("Codex provider implements Provider interface (JSONL streaming tested in test/providers/codex.test.ts)", async () => {
    // Structural check: CodexProvider is instantiable and has the right shape.
    // Full streaming behavior (single message, multi-step, error handling, malformed JSONL)
    // is covered by test/providers/codex.test.ts with spawn mocks.
    const { CodexProvider } = await import("../../src/providers/codex.js");
    const provider = new CodexProvider(minimalConfig);
    expect(typeof provider.chatStream).toBe("function");
    expect(provider.name).toBe("codex-cli");
  });
});

describe("Agent — satori retry loop", () => {
  it("passes on first attempt when verifyFn exits 0", async () => {
    const client = makeStreamingFakeClient([
      makeTextChunks("Done!"),
    ]);
    const provider = new OpenAIProvider(minimalConfig, client);
    const agent = new Agent({ config: minimalConfig, provider });

    const result = await agent.run("fix the bug", {
      maxRetries: 3,
      verifyFn: async () => ({ exitCode: 0, output: "1 passing" }),
    });

    expect(result).toBe("Done!");
  });

  it("retries on non-zero exit and injects failure context", async () => {
    const client = makeStreamingFakeClient([
      makeTextChunks("First attempt"),
      makeTextChunks("Second attempt — fixed"),
    ]);
    const provider = new OpenAIProvider(minimalConfig, client);
    const agent = new Agent({ config: minimalConfig, provider });

    let verifyCallCount = 0;
    const result = await agent.run("fix the bug", {
      maxRetries: 3,
      verifyFn: async () => {
        verifyCallCount++;
        if (verifyCallCount === 1) return { exitCode: 1, output: "1 failing" };
        return { exitCode: 0, output: "all passing" };
      },
    });

    expect(verifyCallCount).toBe(2);
    expect(result).toBe("Second attempt — fixed");
  });

  it("stops at maxRetries if never passes, returns failed note", async () => {
    const client = makeStreamingFakeClient([
      makeTextChunks("Attempt 1"),
      makeTextChunks("Attempt 2"),
      makeTextChunks("Attempt 3"),
    ]);
    const provider = new OpenAIProvider(minimalConfig, client);
    const agent = new Agent({ config: minimalConfig, provider });

    const result = await agent.run("fix the bug", {
      maxRetries: 3,
      verifyFn: async () => ({ exitCode: 1, output: "still failing" }),
    });

    expect(result).toContain("[Satori: verification did not pass after 3 attempts]");
  });

  it("calls preRun once before first attempt", async () => {
    const client = makeStreamingFakeClient([makeTextChunks("Done")]);
    const provider = new OpenAIProvider(minimalConfig, client);
    const agent = new Agent({ config: minimalConfig, provider });

    let preRunCalls = 0;
    await agent.run("fix the bug", {
      maxRetries: 2,
      verifyFn: async () => ({ exitCode: 0, output: "" }),
      preRun: async () => { preRunCalls++; },
    });

    expect(preRunCalls).toBe(1);
  });

  it("calls postRun after each attempt", async () => {
    const client = makeStreamingFakeClient([
      makeTextChunks("Attempt 1"),
      makeTextChunks("Attempt 2"),
    ]);
    const provider = new OpenAIProvider(minimalConfig, client);
    const agent = new Agent({ config: minimalConfig, provider });

    const postRunResults: import("../../src/core/agent.js").SatoriResult[] = [];
    await agent.run("fix the bug", {
      maxRetries: 3,
      verifyFn: async () => {
        const idx = postRunResults.length;
        return idx === 0 ? { exitCode: 1, output: "failing" } : { exitCode: 0, output: "passing" };
      },
      postRun: async (result) => { postRunResults.push(result); },
    });

    expect(postRunResults).toHaveLength(2);
    expect(postRunResults[0].passed).toBe(false);
    expect(postRunResults[1].passed).toBe(true);
  });

  it("model override: resolves 'fast' to config.fast_model", async () => {
    const configWithTiers: Config = {
      ...minimalConfig,
      fast_model: "gpt-4o-mini",
      smart_model: "o3",
    };
    const client = makeStreamingFakeClient([makeTextChunks("done")]);
    const provider = new OpenAIProvider(configWithTiers, client);
    const agent = new Agent({ config: configWithTiers, provider });

    await agent.run("hello", { modelOverride: "fast" });

    // The provider was called — confirm it didn't throw (model resolved)
    expect((client.chat.completions.create as Mock)).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-4o-mini" }),
    );
  });

  it("backward compat: run(message, onDelta) still works", async () => {
    const client = makeStreamingFakeClient([makeTextChunks("hello world")]);
    const provider = new OpenAIProvider(minimalConfig, client);
    const agent = new Agent({ config: minimalConfig, provider });

    const chunks: string[] = [];
    const result = await agent.run("hi", (chunk) => chunks.push(chunk));
    expect(result).toBe("hello world");
    expect(chunks.join("")).toBe("hello world");
  });

  it("applies config.deny to filter tools (deny overrides allow)", async () => {
    const client = makeStreamingFakeClient([makeTextChunks("done")]);
    const provider = new OpenAIProvider(minimalConfig, client);

    // Inject a custom registry with two tools
    const customRegistry = new ToolRegistry();
    customRegistry.register({
      name: "file_read",
      description: "Read a file",
      parameters: z.object({}),
      async execute() { return { success: true, output: "" }; },
    });
    customRegistry.register({
      name: "shell",
      description: "Run a command",
      parameters: z.object({}),
      async execute() { return { success: true, output: "" }; },
    });

    const configWithDeny: Config = { ...minimalConfig, deny: ["shell"] };
    const agent = new Agent({ config: configWithDeny, tools: customRegistry, provider });

    // Confirm that only file_read is in the tool list passed to the provider
    await agent.run("do something");
    const callArgs = (client.chat.completions.create as Mock).mock.calls[0][0] as { tools?: { function: { name: string } }[] };
    const toolNames = (callArgs.tools ?? []).map((t) => t.function.name);
    expect(toolNames).toContain("file_read");
    expect(toolNames).not.toContain("shell");
  });
});

describe("Agent.setConversation() — system prompt preservation", () => {
  // A minimal provider stub — setConversation tests don't need to call run().
  const stubProvider = new OpenAIProvider(
    { apiKey: "sk-test", model: "gpt-4o" } as Config,
    makeStreamingFakeClient([]),
  );

  function makeAgent(systemPrompt: string) {
    return new Agent({ config: minimalConfig, provider: stubProvider, systemPrompt });
  }

  it("strips system messages from the incoming conversation", () => {
    const agent = makeAgent("agent-system-prompt");
    const foreignConv = Conversation.fromMessages([
      { role: "system", content: "foreign-system" },
      { role: "user", content: "user message from clone" },
    ]);
    agent.setConversation(foreignConv);
    const msgs = agent.getConversation().getMessages();
    expect(msgs.some((m) => m.content === "foreign-system")).toBe(false);
  });

  it("preserves the agent's own system prompt after setConversation()", () => {
    const agent = makeAgent("my-unique-system-prompt");
    const loadedConv = Conversation.fromMessages([
      { role: "system", content: "other-system-to-be-stripped" },
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
    agent.setConversation(loadedConv);
    const msgs = agent.getConversation().getMessages();
    const sysMsg = msgs.find((m) => m.role === "system");
    // buildSystemPrompt() wraps the custom prompt — check it's still present
    expect(sysMsg?.content).toContain("my-unique-system-prompt");
    expect(msgs.some((m) => m.content === "other-system-to-be-stripped")).toBe(false);
  });

  it("carries non-system messages from the loaded conversation", () => {
    const agent = makeAgent("system");
    const loadedConv = Conversation.fromMessages([
      { role: "user", content: "question from clone" },
      { role: "assistant", content: "answer from clone" },
    ]);
    agent.setConversation(loadedConv);
    const msgs = agent.getConversation().getMessages();
    const contents = msgs.map((m) => m.content);
    expect(contents).toContain("question from clone");
    expect(contents).toContain("answer from clone");
  });

  it("works when incoming conversation has no system message (legacy v1 session)", () => {
    const agent = makeAgent("my-unique-system-prompt");
    // A v1-format loaded session would have no system message
    const noSysConv = Conversation.fromMessages([
      { role: "user", content: "legacy message" },
    ]);
    agent.setConversation(noSysConv);
    const msgs = agent.getConversation().getMessages();
    const sysMsg = msgs.find((m) => m.role === "system");
    expect(sysMsg?.content).toContain("my-unique-system-prompt");
    expect(msgs.some((m) => m.content === "legacy message")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tool error reflection (Sprint 49)
// ---------------------------------------------------------------------------

describe("tool error reflection", () => {
  function makeReflectionRegistry(): ToolRegistry {
    const registry = new ToolRegistry();
    registry.register({
      name: "fail_tool",
      description: "Always fails",
      parameters: z.object({}),
      async execute(_args: unknown) {
        return { success: false, output: "", error: "intentional failure" };
      },
    });
    registry.register({
      name: "throw_tool",
      description: "Always throws",
      parameters: z.object({}),
      async execute(_args: unknown): Promise<{ success: boolean; output: string }> {
        throw new Error("unexpected tool crash");
      },
    });
    return registry;
  }

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("injects reflection fragment into conversation when tool returns success:false (attempt 1)", async () => {
    const fakeClient = makeStreamingFakeClient([
      makeToolCallChunks("fail_tool", {}),
      makeTextChunks("I see the tool failed — reflecting now"),
    ]);
    const provider = new OpenAIProvider(minimalConfig, fakeClient);
    const agent = new Agent({
      config: minimalConfig,
      provider,
      tools: makeReflectionRegistry(),
      systemPrompt: "You are a test assistant.",
    });

    const conversationAddUserSpy = vi.spyOn(agent.getConversation(), "addUser");

    await agent.run("Try the fail tool");

    // The reflection fragment should have been injected as a user message
    const reflectionCalls = conversationAddUserSpy.mock.calls.filter(
      ([msg]) => typeof msg === "string" && msg.includes("Tool failure reflection"),
    );
    expect(reflectionCalls.length).toBe(1);
  });

  it("injects reflection fragment when tool throws (catch path)", async () => {
    const fakeClient = makeStreamingFakeClient([
      makeToolCallChunks("throw_tool", {}),
      makeTextChunks("I see the tool threw an error"),
    ]);
    const provider = new OpenAIProvider(minimalConfig, fakeClient);
    const agent = new Agent({
      config: minimalConfig,
      provider,
      tools: makeReflectionRegistry(),
      systemPrompt: "You are a test assistant.",
    });

    const conversationAddUserSpy = vi.spyOn(agent.getConversation(), "addUser");

    await agent.run("Try the throw tool");

    const reflectionCalls = conversationAddUserSpy.mock.calls.filter(
      ([msg]) => typeof msg === "string" && msg.includes("Tool failure reflection"),
    );
    expect(reflectionCalls.length).toBe(1);
  });

  it("does not inject reflection when tool succeeds", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "success_tool",
      description: "Always succeeds",
      parameters: z.object({}),
      async execute(_args: unknown) {
        return { success: true, output: "all good" };
      },
    });
    const fakeClient = makeStreamingFakeClient([
      makeToolCallChunks("success_tool", {}),
      makeTextChunks("Tool succeeded"),
    ]);
    const provider = new OpenAIProvider(minimalConfig, fakeClient);
    const agent = new Agent({
      config: minimalConfig,
      provider,
      tools: registry,
      systemPrompt: "You are a test assistant.",
    });

    const conversationAddUserSpy = vi.spyOn(agent.getConversation(), "addUser");

    await agent.run("Try the success tool");

    const reflectionCalls = conversationAddUserSpy.mock.calls.filter(
      ([msg]) => typeof msg === "string" && msg.includes("Tool failure reflection"),
    );
    expect(reflectionCalls.length).toBe(0);
  });

  it("does not inject reflection when PHASE2S_TOOL_ERROR_REFLECTION=off", async () => {
    vi.stubEnv("PHASE2S_TOOL_ERROR_REFLECTION", "off");

    const fakeClient = makeStreamingFakeClient([
      makeToolCallChunks("fail_tool", {}),
      makeTextChunks("Tool failed but no reflection"),
    ]);
    const provider = new OpenAIProvider(minimalConfig, fakeClient);
    const agent = new Agent({
      config: minimalConfig,
      provider,
      tools: makeReflectionRegistry(),
      systemPrompt: "You are a test assistant.",
    });

    const conversationAddUserSpy = vi.spyOn(agent.getConversation(), "addUser");

    await agent.run("Try the fail tool");

    const reflectionCalls = conversationAddUserSpy.mock.calls.filter(
      ([msg]) => typeof msg === "string" && msg.includes("Tool failure reflection"),
    );
    expect(reflectionCalls.length).toBe(0);
  });

  it("injects reflection fragment when tool call has invalid JSON arguments", async () => {
    // The invalid-JSON path sets hadToolError=true before the reflect check
    const badArgsChunks: import("openai/resources/chat/completions.js").ChatCompletionChunk[] = [
      {
        id: "chatcmpl-test",
        object: "chat.completion.chunk",
        created: 1234567890,
        model: "gpt-4o",
        choices: [{
          index: 0,
          delta: { role: "assistant", content: null, tool_calls: [{ index: 0, id: "call_bad", type: "function", function: { name: "fail_tool", arguments: "" } }] },
          finish_reason: null,
          logprobs: null,
        }],
      },
      {
        id: "chatcmpl-test",
        object: "chat.completion.chunk",
        created: 1234567890,
        model: "gpt-4o",
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: "<<<not-json>>>" } }] }, finish_reason: null, logprobs: null }],
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
      makeTextChunks("Bad JSON noted — reflecting"),
    ]);
    const provider = new OpenAIProvider(minimalConfig, fakeClient);
    const agent = new Agent({
      config: minimalConfig,
      provider,
      tools: makeReflectionRegistry(),
      systemPrompt: "You are a test assistant.",
    });

    const conversationAddUserSpy = vi.spyOn(agent.getConversation(), "addUser");

    await agent.run("Bad JSON tool call");

    const reflectionCalls = conversationAddUserSpy.mock.calls.filter(
      ([msg]) => typeof msg === "string" && msg.includes("Tool failure reflection"),
    );
    expect(reflectionCalls.length).toBe(1);
  });

  it("does not inject reflection on satori attempt 2+ (doom-loop takes over)", async () => {
    // Attempt 1 fails verification → doom-loop context injected → attempt 2 should NOT
    // get tool reflection even if a tool fails (toolReflectionEnabled=false for attempt 2+).
    let attempt = 0;
    const fakeClient = makeStreamingFakeClient([
      // Attempt 1: tool fails
      makeToolCallChunks("fail_tool", {}),
      makeTextChunks("Attempt 1 done"),
      // Attempt 2: tool fails again
      makeToolCallChunks("fail_tool", {}),
      makeTextChunks("Attempt 2 done"),
    ]);
    const provider = new OpenAIProvider(minimalConfig, fakeClient);
    const agent = new Agent({
      config: minimalConfig,
      provider,
      tools: makeReflectionRegistry(),
      systemPrompt: "You are a test assistant.",
    });

    const conversationAddUserSpy = vi.spyOn(agent.getConversation(), "addUser");

    await agent.run("Try the fail tool with satori", {
      maxRetries: 2,
      verifyFn: async () => {
        attempt++;
        return { exitCode: attempt < 2 ? 1 : 0, output: "verify output" };
      },
    });

    // Reflection should appear exactly once — only on attempt 1
    const reflectionCalls = conversationAddUserSpy.mock.calls.filter(
      ([msg]) => typeof msg === "string" && msg.includes("Tool failure reflection"),
    );
    expect(reflectionCalls.length).toBe(1);
  });
});
