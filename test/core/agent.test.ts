/**
 * Agent integration tests.
 *
 * Tests the full agent loop using a typed OpenAI client stub (OpenAIClientLike)
 * injected via AgentOptions.provider. No real API key required — all LLM responses
 * are mocked. Uses a minimal in-memory ToolRegistry with simple stub tools to avoid
 * filesystem side effects and make failures easy to diagnose.
 */
import { describe, it, expect, vi } from "vitest";
import type { ChatCompletion } from "openai/resources/chat/completions.js";
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
 * Build a fake OpenAI client that returns responses from the queue in order.
 * Each call to create() pops the next response from the array.
 */
function makeFakeClient(responses: ChatCompletion[]): OpenAIClientLike {
  return {
    chat: {
      completions: {
        create: vi.fn().mockImplementation(() =>
          Promise.resolve(responses.shift()!)
        ),
      },
    },
  };
}

/**
 * Build a minimal ChatCompletion with finish_reason "stop" and text content.
 */
function makeTextResponse(text: string): ChatCompletion {
  return {
    id: "chatcmpl-test",
    object: "chat.completion",
    created: 1234567890,
    model: "gpt-4o",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: text,
          refusal: null,
        },
        finish_reason: "stop",
        logprobs: null,
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
  };
}

/**
 * Build a ChatCompletion with finish_reason "tool_calls" and one tool call.
 */
function makeToolCallResponse(toolName: string, args: Record<string, unknown>): ChatCompletion {
  return {
    id: "chatcmpl-test",
    object: "chat.completion",
    created: 1234567890,
    model: "gpt-4o",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: null,
          refusal: null,
          tool_calls: [
            {
              id: "call_abc123",
              type: "function",
              function: {
                name: toolName,
                arguments: JSON.stringify(args),
              },
            },
          ],
        },
        finish_reason: "tool_calls",
        logprobs: null,
      },
    ],
    usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
  };
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
    const fakeClient = makeFakeClient([makeTextResponse("Hello from the LLM!")]);
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
    const fakeClient = makeFakeClient([
      makeToolCallResponse("echo", { text: "world" }),
      makeTextResponse("The echo tool returned: echo: world"),
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
    const fakeClient = makeFakeClient([
      makeToolCallResponse("echo", { text: "first" }),
      makeToolCallResponse("echo", { text: "second" }),
      makeTextResponse("Done after two tool calls"),
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
    const fakeClient = makeFakeClient([
      makeToolCallResponse("fail_tool", { reason: "test" }),
      makeTextResponse("I see the tool failed with: boom"),
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
    const infiniteResponses: ChatCompletion[] = Array.from({ length: 10 }, () =>
      makeToolCallResponse("echo", { text: "loop" })
    );
    const fakeClient = makeFakeClient(infiniteResponses);
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
    const truncatedResponse: ChatCompletion = {
      id: "chatcmpl-test",
      object: "chat.completion",
      created: 1234567890,
      model: "gpt-4o",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "Partial response here...",
            refusal: null,
          },
          finish_reason: "length",
          logprobs: null,
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 100, total_tokens: 110 },
    };

    const fakeClient = makeFakeClient([truncatedResponse]);
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
    const filteredResponse: ChatCompletion = {
      id: "chatcmpl-test",
      object: "chat.completion",
      created: 1234567890,
      model: "gpt-4o",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            refusal: null,
          },
          finish_reason: "content_filter",
          logprobs: null,
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
    };

    const fakeClient = makeFakeClient([filteredResponse]);
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
    // LLM returns a tool call with invalid JSON arguments
    const badJsonResponse: ChatCompletion = {
      id: "chatcmpl-test",
      object: "chat.completion",
      created: 1234567890,
      model: "gpt-4o",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            refusal: null,
            tool_calls: [
              {
                id: "call_bad",
                type: "function",
                function: {
                  name: "echo",
                  arguments: "not-valid-json",
                },
              },
            ],
          },
          finish_reason: "tool_calls",
          logprobs: null,
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    };

    const fakeClient = makeFakeClient([
      badJsonResponse,
      makeTextResponse("I see there was a JSON error"),
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
});
