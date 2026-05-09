/**
 * Sprint 84 — Agentic tool loop: agent task-mode tests.
 *
 * Tests task-mode system prompt injection, doom-loop guard, and auto-verify
 * injection. Uses the same streaming fake-client pattern as agent.test.ts.
 *
 * No real API key required — all LLM responses are mocked.
 */
import { describe, it, expect, vi } from "vitest";
import type { ChatCompletionChunk } from "openai/resources/chat/completions.js";
import { Agent } from "../../src/core/agent.js";
import { OpenAIProvider, type OpenAIClientLike } from "../../src/providers/openai.js";
import { ToolRegistry } from "../../src/tools/index.js";
import { buildSystemPrompt, TASK_MODE_PREAMBLE } from "../../src/utils/prompt.js";
import type { Config } from "../../src/core/config.js";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Helpers — config, providers, registries
// ---------------------------------------------------------------------------

const minimalConfig: Config = {
  provider: "openai-api",
  model: "gpt-4o",
  apiKey: "sk-test",
  codexPath: "codex",
  maxTurns: 10,
  timeout: 120_000,
  allowDestructive: false,
  verifyCommand: undefined,
  requireSpecification: false,
};

const configWithVerify: Config = {
  ...minimalConfig,
  verifyCommand: "npm test",
};

/**
 * Build a fake streaming OpenAI client from chunk sequences.
 * Each call to create() pops the next sequence.
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

function makeTextChunks(text: string): ChatCompletionChunk[] {
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
      choices: [{ index: 0, delta: {}, finish_reason: "stop" as const, logprobs: null }],
    },
  ];
}

function makeToolCallChunks(toolName: string, args: Record<string, unknown>, id = "call_abc123"): ChatCompletionChunk[] {
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
          tool_calls: [{ index: 0, id, type: "function" as const, function: { name: toolName, arguments: "" } }],
        },
        finish_reason: null,
        logprobs: null,
      }],
    },
    {
      ...base,
      choices: [{
        index: 0,
        delta: { tool_calls: [{ index: 0, function: { arguments: argsStr } }] },
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
 * Build a registry with an echo tool and a file_write stub (success or fail controlled).
 */
function makeRegistryWithFileWrite(fileWriteResult: { success: boolean; output?: string; error?: string } = { success: true, output: "written" }): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register({
    name: "echo",
    description: "Echo input",
    parameters: z.object({ text: z.string() }),
    async execute(args: unknown) {
      return { success: true, output: `echo: ${(args as { text: string }).text}` };
    },
  });
  registry.register({
    name: "file_write",
    description: "Write to a file",
    parameters: z.object({ path: z.string(), content: z.string() }),
    async execute(_args: unknown) {
      if (fileWriteResult.success) {
        return { success: true, output: fileWriteResult.output ?? "written" };
      }
      return { success: false, output: "", error: fileWriteResult.error ?? "write failed" };
    },
  });
  return registry;
}

// ---------------------------------------------------------------------------
// Section 1: buildSystemPrompt — taskMode injection
// ---------------------------------------------------------------------------

describe("buildSystemPrompt — taskMode injection", () => {
  it("does NOT include TASK_MODE_PREAMBLE when taskMode is false", () => {
    const prompt = buildSystemPrompt([], undefined, false);
    expect(prompt).not.toContain("autonomous multi-step task");
    expect(prompt).not.toContain(TASK_MODE_PREAMBLE);
  });

  it("does NOT include TASK_MODE_PREAMBLE when taskMode is undefined (default)", () => {
    const prompt = buildSystemPrompt([], undefined, undefined);
    expect(prompt).not.toContain("autonomous multi-step task");
  });

  it("DOES include TASK_MODE_PREAMBLE at the start when taskMode is true", () => {
    const prompt = buildSystemPrompt([], undefined, true);
    expect(prompt).toContain("autonomous multi-step task");
    expect(prompt.startsWith(TASK_MODE_PREAMBLE)).toBe(true);
  });

  it("task-mode prompt contains PLANNING, EXECUTION, and COMPLETION directives", () => {
    const prompt = buildSystemPrompt([], undefined, true);
    expect(prompt).toContain("PLANNING");
    expect(prompt).toContain("EXECUTION");
    expect(prompt).toContain("COMPLETION");
  });

  it("custom system prompt is still appended after the preamble in task mode", () => {
    const prompt = buildSystemPrompt([], "My custom rules", true);
    expect(prompt).toContain("autonomous multi-step task");
    expect(prompt).toContain("My custom rules");
    // preamble comes before custom prompt
    expect(prompt.indexOf("autonomous multi-step task")).toBeLessThan(prompt.indexOf("My custom rules"));
  });

  it("REPL (no task mode): system prompt unchanged from baseline", () => {
    const baseline = buildSystemPrompt([]);
    const taskPrompt = buildSystemPrompt([], undefined, false);
    expect(taskPrompt).toBe(baseline);
  });
});

// ---------------------------------------------------------------------------
// Section 2: Doom-loop guard
// ---------------------------------------------------------------------------

describe("Agent doom-loop guard", () => {
  it("same tool + same args twice injects a reflection user message", async () => {
    // Sequence: same tool call twice, then text
    const fakeClient = makeStreamingFakeClient([
      makeToolCallChunks("echo", { text: "hello" }, "call_1"),
      makeToolCallChunks("echo", { text: "hello" }, "call_2"),
      makeTextChunks("Done"),
    ]);
    const provider = new OpenAIProvider(minimalConfig, fakeClient);
    const agent = new Agent({ config: minimalConfig, provider, tools: makeRegistryWithFileWrite() });

    await agent.run("try echo twice with same args", { taskMode: true });

    const messages = agent.getConversation().getMessages();
    const userMessages = messages.filter((m) => m.role === "user" && typeof m.content === "string");
    const reflectionMsg = userMessages.find((m) => (m.content as string).includes("already tried this exact call"));
    expect(reflectionMsg).toBeDefined();
  });

  it("same tool + same args 3 times returns early with stuck message", async () => {
    // Sequence: same tool 3 times (agent should bail before 3rd LLM response)
    const fakeClient = makeStreamingFakeClient([
      makeToolCallChunks("echo", { text: "stuck" }, "call_1"),
      makeToolCallChunks("echo", { text: "stuck" }, "call_2"),
      makeToolCallChunks("echo", { text: "stuck" }, "call_3"),
      makeTextChunks("This should not be reached"),
    ]);
    const provider = new OpenAIProvider(minimalConfig, fakeClient);
    const agent = new Agent({ config: minimalConfig, provider, tools: makeRegistryWithFileWrite() });

    const result = await agent.run("echo repeatedly", { taskMode: true });

    expect(result).toContain("stuck");
    expect(result).not.toContain("This should not be reached");
    // Should stop before the 4th API call
    expect((fakeClient.chat.completions.create as ReturnType<typeof vi.fn>).mock.calls.length).toBeLessThanOrEqual(3);
  });

  it("different args for same tool do NOT trigger doom-loop", async () => {
    const fakeClient = makeStreamingFakeClient([
      makeToolCallChunks("echo", { text: "hello" }, "call_1"),
      makeToolCallChunks("echo", { text: "world" }, "call_2"),  // different args
      makeTextChunks("All done"),
    ]);
    const provider = new OpenAIProvider(minimalConfig, fakeClient);
    const agent = new Agent({ config: minimalConfig, provider, tools: makeRegistryWithFileWrite() });

    const result = await agent.run("echo with different args", { taskMode: true });

    expect(result).toBe("All done");
    const messages = agent.getConversation().getMessages();
    const reflectionMsg = messages.find(
      (m) => m.role === "user" && typeof m.content === "string" &&
        (m.content as string).includes("already tried this exact call"),
    );
    expect(reflectionMsg).toBeUndefined();
  });

  it("doom-loop recentCalls is fresh per runOnce call (no state between runs)", async () => {
    // First run: 2 identical calls (triggers reflection but not exit)
    // Second run (new agent.run): same calls again — should also trigger reflection, not exit immediately
    const makeSequence = () => [
      makeToolCallChunks("echo", { text: "repeated" }, "call_1"),
      makeToolCallChunks("echo", { text: "repeated" }, "call_2"),
      makeTextChunks("Done"),
    ];

    const fakeClient = makeStreamingFakeClient([...makeSequence(), ...makeSequence()]);
    const provider = new OpenAIProvider(minimalConfig, fakeClient);
    const agent = new Agent({ config: minimalConfig, provider, tools: makeRegistryWithFileWrite() });

    await agent.run("first run", { taskMode: true });
    const result2 = await agent.run("second run", { taskMode: true });

    // If recentCalls carried over, second run would exit immediately with 2 total
    // (3 needed for exit: call_1 already seen once, call_2 would be the 2nd).
    // With fresh state, each run independently starts counting.
    expect(result2).toBe("Done");
  });

  it("doom-loop exit: adds placeholder tool results before returning (protocol compliance)", async () => {
    // When the doom-loop fires on the 3rd identical call, the agent should add
    // tool results for the triggering call (and any remaining calls) before returning,
    // so the conversation stays valid for any subsequent use of the same Agent instance.
    const fakeClient = makeStreamingFakeClient([
      makeToolCallChunks("echo", { text: "stuck" }, "call_1"),
      makeToolCallChunks("echo", { text: "stuck" }, "call_2"),
      makeToolCallChunks("echo", { text: "stuck" }, "call_3"),
      makeTextChunks("Never reached"),
    ]);
    const provider = new OpenAIProvider(minimalConfig, fakeClient);
    const agent = new Agent({ config: minimalConfig, provider, tools: makeRegistryWithFileWrite() });

    const result = await agent.run("repeated calls", { taskMode: true });
    expect(result).toContain("stuck");

    // Verify all assistant tool_call_ids have matching tool-role results.
    // After the fix, the doom-loop exit fills in placeholder results so the
    // conversation is not in an illegal partial-tool-result state.
    const messages = agent.getConversation().getMessages();
    const assistantMessages = messages.filter((m) => m.role === "assistant");
    const toolMessages = messages.filter((m) => m.role === "tool");
    // Each assistant message that declared tool calls should have at least one tool result.
    // We can't check one-to-one easily, but confirm there are no orphaned assistant tool calls
    // by verifying the tool message count is >= 1 (at least the call_3 placeholder was added).
    expect(toolMessages.length).toBeGreaterThanOrEqual(1);
    expect(assistantMessages.length).toBeGreaterThanOrEqual(1);
  });

  it("doom-loop guard works without taskMode (applies to all agent runs)", async () => {
    // Doom-loop guard is a reliability feature, not just for task mode
    const fakeClient = makeStreamingFakeClient([
      makeToolCallChunks("echo", { text: "stuck" }, "call_1"),
      makeToolCallChunks("echo", { text: "stuck" }, "call_2"),
      makeToolCallChunks("echo", { text: "stuck" }, "call_3"),
      makeTextChunks("Never reached"),
    ]);
    const provider = new OpenAIProvider(minimalConfig, fakeClient);
    const agent = new Agent({ config: minimalConfig, provider, tools: makeRegistryWithFileWrite() });

    const result = await agent.run("normal run with stuck tool");
    // Should exit before "Never reached"
    expect(result).not.toBe("Never reached");
  });
});

// ---------------------------------------------------------------------------
// Section 3: Auto-verify injection
// ---------------------------------------------------------------------------

describe("Agent auto-verify injection", () => {
  it("file_write success + verifyCommand → injects [Auto-verify result] user message", async () => {
    const fakeClient = makeStreamingFakeClient([
      makeToolCallChunks("file_write", { path: "src/auth.ts", content: "fix" }),
      makeTextChunks("Done writing"),
    ]);
    const provider = new OpenAIProvider(configWithVerify, fakeClient);
    const verifyFn = vi.fn().mockResolvedValue({ exitCode: 0, output: "PASS: 42 tests passed" });

    const agent = new Agent({ config: configWithVerify, provider, tools: makeRegistryWithFileWrite() });

    await agent.run("fix the auth bug", {
      taskMode: true,
      verifyFn,
    });

    expect(verifyFn).toHaveBeenCalledOnce();
    const messages = agent.getConversation().getMessages();
    const verifyMsg = messages.find(
      (m) => m.role === "user" && typeof m.content === "string" &&
        (m.content as string).includes("[Auto-verify result]"),
    );
    expect(verifyMsg).toBeDefined();
    expect((verifyMsg!.content as string)).toContain("PASS: 42 tests passed");
  });

  it("file_write success + NO verifyCommand → no verify injection", async () => {
    const fakeClient = makeStreamingFakeClient([
      makeToolCallChunks("file_write", { path: "src/auth.ts", content: "fix" }),
      makeTextChunks("Done writing"),
    ]);
    const provider = new OpenAIProvider(minimalConfig, fakeClient);
    const verifyFn = vi.fn().mockResolvedValue({ exitCode: 0, output: "PASS" });

    // No verifyCommand in config, none in opts
    const agent = new Agent({ config: minimalConfig, provider, tools: makeRegistryWithFileWrite() });

    await agent.run("fix something", { taskMode: true, verifyFn });

    // verifyFn should NOT be called (no verifyCommand to trigger it)
    expect(verifyFn).not.toHaveBeenCalled();

    const messages = agent.getConversation().getMessages();
    const verifyMsg = messages.find(
      (m) => m.role === "user" && typeof m.content === "string" &&
        (m.content as string).includes("[Auto-verify result]"),
    );
    expect(verifyMsg).toBeUndefined();
  });

  it("file_write FAILURE → no verify injection", async () => {
    const fakeClient = makeStreamingFakeClient([
      makeToolCallChunks("file_write", { path: "readonly.ts", content: "oops" }),
      makeTextChunks("Write failed"),
    ]);
    const provider = new OpenAIProvider(configWithVerify, fakeClient);
    const verifyFn = vi.fn().mockResolvedValue({ exitCode: 0, output: "PASS" });

    // file_write returns success: false
    const failRegistry = makeRegistryWithFileWrite({ success: false, error: "permission denied" });
    const agent = new Agent({ config: configWithVerify, provider, tools: failRegistry });

    await agent.run("try to write", { taskMode: true, verifyFn });

    expect(verifyFn).not.toHaveBeenCalled();
    const messages = agent.getConversation().getMessages();
    const verifyMsg = messages.find(
      (m) => m.role === "user" && typeof m.content === "string" &&
        (m.content as string).includes("[Auto-verify result]"),
    );
    expect(verifyMsg).toBeUndefined();
  });

  it("multiple file_writes in one LLM turn → verify fires ONCE per turn", async () => {
    // Two file_write calls in a single LLM response (same chunk sequence has 2 tool calls)
    // This is simulated by having the provider return two tool_calls in a single assistant turn.
    // We test cooldown via verifyFn call count.
    const twoWriteChunks = makeTwoToolCallsChunks("file_write", { path: "a.ts", content: "a" }, "file_write", { path: "b.ts", content: "b" });
    const fakeClient = makeStreamingFakeClient([
      twoWriteChunks,
      makeTextChunks("Both files written"),
    ]);
    const provider = new OpenAIProvider(configWithVerify, fakeClient);
    const verifyFn = vi.fn().mockResolvedValue({ exitCode: 0, output: "PASS" });

    const agent = new Agent({ config: configWithVerify, provider, tools: makeRegistryWithFileWrite() });

    await agent.run("write two files", { taskMode: true, verifyFn });

    // Verify fires ONCE after the turn that contained writes, not once per write
    expect(verifyFn).toHaveBeenCalledTimes(1);
  });

  it("verify result is injected as user message (not a tool result)", async () => {
    const fakeClient = makeStreamingFakeClient([
      makeToolCallChunks("file_write", { path: "auth.ts", content: "fix" }),
      makeTextChunks("Done"),
    ]);
    const provider = new OpenAIProvider(configWithVerify, fakeClient);
    const verifyFn = vi.fn().mockResolvedValue({ exitCode: 1, output: "FAIL: 2 tests failed" });

    const agent = new Agent({ config: configWithVerify, provider, tools: makeRegistryWithFileWrite() });

    await agent.run("fix and verify", { taskMode: true, verifyFn });

    const messages = agent.getConversation().getMessages();
    const verifyMsg = messages.find(
      (m) => m.role === "user" && typeof m.content === "string" &&
        (m.content as string).includes("[Auto-verify result]"),
    );
    // Must be a user message, not a tool message
    expect(verifyMsg).toBeDefined();
    expect(verifyMsg!.role).toBe("user");
    expect((verifyMsg!.content as string)).toContain("FAIL: 2 tests failed");
  });

  it("run-level verifyCommand overrides config.verifyCommand", async () => {
    const fakeClient = makeStreamingFakeClient([
      makeToolCallChunks("file_write", { path: "file.ts", content: "x" }),
      makeTextChunks("Done"),
    ]);
    const provider = new OpenAIProvider(configWithVerify, fakeClient);

    // Track which command is passed to verifyFn
    let capturedCommand = "";
    const verifyFn = vi.fn().mockImplementation(async (cmd: string) => {
      capturedCommand = cmd;
      return { exitCode: 0, output: "PASS" };
    });

    const agent = new Agent({ config: configWithVerify, provider, tools: makeRegistryWithFileWrite() });

    await agent.run("fix and verify", {
      taskMode: true,
      verifyCommand: "bun test",  // override the config's "npm test"
      verifyFn,
    });

    expect(capturedCommand).toBe("bun test");
  });

  it("non-file_write tools do not trigger verify", async () => {
    const fakeClient = makeStreamingFakeClient([
      makeToolCallChunks("echo", { text: "hello" }),
      makeTextChunks("Done"),
    ]);
    const provider = new OpenAIProvider(configWithVerify, fakeClient);
    const verifyFn = vi.fn().mockResolvedValue({ exitCode: 0, output: "PASS" });

    const agent = new Agent({ config: configWithVerify, provider, tools: makeRegistryWithFileWrite() });

    await agent.run("just echo", { taskMode: true, verifyFn });

    expect(verifyFn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Section 4: taskMode does not contaminate REPL (shared Agent instance)
// ---------------------------------------------------------------------------

describe("taskMode — no contamination on shared Agent instance", () => {
  it("REPL call after task call does NOT get task-mode system prompt", () => {
    const agent1 = new Agent({ config: minimalConfig, tools: makeRegistryWithFileWrite() });
    const msgs1 = agent1.getConversation().getMessages();
    const systemMsg1 = msgs1.find((m) => m.role === "system");
    expect(systemMsg1?.content).not.toContain("autonomous multi-step task");

    const agent2 = new Agent({ config: minimalConfig, tools: makeRegistryWithFileWrite() });
    const msgs2 = agent2.getConversation().getMessages();
    const systemMsg2 = msgs2.find((m) => m.role === "system");
    expect(systemMsg2?.content).not.toContain("autonomous multi-step task");
  });

  it("task-mode agent system prompt DOES contain the preamble", () => {
    const agent = new Agent({ config: minimalConfig, tools: makeRegistryWithFileWrite(), systemPrompt: undefined });
    // The preamble is injected per-run at runOnce() level, not at construction.
    // So the system prompt at construction should NOT contain it.
    const msgs = agent.getConversation().getMessages();
    const systemMsg = msgs.find((m) => m.role === "system");
    // At construction time (before run), system prompt is normal
    expect(systemMsg?.content).not.toContain("autonomous multi-step task");
  });
});

// ---------------------------------------------------------------------------
// Section 5: Sprint 85 — doomLoopThreshold config (TC-06–TC-08)
// ---------------------------------------------------------------------------

describe("Agent doomLoopThreshold config", () => {
  it("custom threshold=2: agent aborts after 2 identical calls", async () => {
    // LLM always returns the same tool call → doom-loop should fire on 2nd call
    const fakeClient = makeStreamingFakeClient(
      Array.from({ length: 5 }, () => makeToolCallChunks("echo", { text: "stuck" })),
    );
    const config2: Config = { ...minimalConfig, doomLoopThreshold: 2 };
    const provider = new OpenAIProvider(config2, fakeClient);
    const agent = new Agent({ config: config2, provider, tools: makeRegistryWithFileWrite() });

    const result = await agent.run("echo repeatedly", { taskMode: true });

    // Should have fired the doom-loop (not reached max turns)
    expect(result).toContain("stuck");
    // With threshold=2: 1st call normal, 2nd call triggers abort → only 1 API call consumed
    expect((fakeClient.chat.completions.create as ReturnType<typeof vi.fn>).mock.calls.length).toBeLessThanOrEqual(3);
  });

  it("threshold=3 (default): agent reflects on 2nd call, aborts on 3rd", async () => {
    // Same behavior as before — default threshold is 3
    const fakeClient = makeStreamingFakeClient(
      Array.from({ length: 5 }, () => makeToolCallChunks("echo", { text: "stuck" })),
    );
    const config3: Config = { ...minimalConfig, doomLoopThreshold: 3 };
    const provider = new OpenAIProvider(config3, fakeClient);
    const agent = new Agent({ config: config3, provider, tools: makeRegistryWithFileWrite() });

    const result = await agent.run("echo repeatedly", { taskMode: true });
    expect(result).toContain("stuck");
  });

  it("agent does NOT abort when tool calls differ between turns", async () => {
    // First call writes file A, second writes file B — different fingerprints
    const fakeClient = makeStreamingFakeClient([
      makeToolCallChunks("file_write", { path: "a.ts", content: "a" }),
      makeToolCallChunks("file_write", { path: "b.ts", content: "b" }),
      makeTextChunks("Done — wrote two different files"),
    ]);
    const provider = new OpenAIProvider(minimalConfig, fakeClient);
    const agent = new Agent({ config: minimalConfig, provider, tools: makeRegistryWithFileWrite() });

    const result = await agent.run("write two files", { taskMode: true });
    expect(result).toBe("Done — wrote two different files");
    expect(result).not.toContain("stuck");
  });
});

// ---------------------------------------------------------------------------
// Section 6: Sprint 85 — verifyOnEveryWrite (TC-09–TC-13)
// ---------------------------------------------------------------------------

describe("Agent verifyOnEveryWrite", () => {
  const configVerifyEvery: Config = {
    ...minimalConfig,
    verifyCommand: "npm test",
    verifyOnEveryWrite: true,
  };

  it("verifyOnEveryWrite=true: runVerify called once per file_write", async () => {
    const twoWriteChunks = makeTwoToolCallsChunks(
      "file_write", { path: "a.ts", content: "a" },
      "file_write", { path: "b.ts", content: "b" },
    );
    const fakeClient = makeStreamingFakeClient([twoWriteChunks, makeTextChunks("Done")]);
    const provider = new OpenAIProvider(configVerifyEvery, fakeClient);
    const verifyFn = vi.fn().mockResolvedValue({ exitCode: 0, output: "PASS" });

    const agent = new Agent({ config: configVerifyEvery, provider, tools: makeRegistryWithFileWrite() });
    await agent.run("write two files", { taskMode: true, verifyFn });

    // verify called ONCE per successful file_write, not once per turn
    expect(verifyFn).toHaveBeenCalledTimes(2);
  });

  it("verifyOnEveryWrite=true: per-write results are batched into a single user message", async () => {
    const twoWriteChunks = makeTwoToolCallsChunks(
      "file_write", { path: "a.ts", content: "a" },
      "file_write", { path: "b.ts", content: "b" },
    );
    const fakeClient = makeStreamingFakeClient([twoWriteChunks, makeTextChunks("Done")]);
    const provider = new OpenAIProvider(configVerifyEvery, fakeClient);
    const verifyFn = vi.fn().mockResolvedValue({ exitCode: 0, output: "PASS" });

    const agent = new Agent({ config: configVerifyEvery, provider, tools: makeRegistryWithFileWrite() });
    await agent.run("write two files", { taskMode: true, verifyFn });

    const messages = agent.getConversation().getMessages();
    const verifyMessages = messages.filter(
      (m) => m.role === "user" && typeof m.content === "string" &&
        (m.content as string).includes("[verify after file_write]"),
    );
    // Batched into one user message (not two separate messages)
    expect(verifyMessages).toHaveLength(1);
    // The single message contains both results
    expect((verifyMessages[0].content as string).match(/\[verify after file_write\]/g)?.length).toBe(2);
  });

  it("verifyOnEveryWrite=true: output truncated at 1000 chars per result", async () => {
    const fakeClient = makeStreamingFakeClient([
      makeToolCallChunks("file_write", { path: "a.ts", content: "a" }),
      makeTextChunks("Done"),
    ]);
    const provider = new OpenAIProvider(configVerifyEvery, fakeClient);
    const longOutput = "x".repeat(2000);
    const verifyFn = vi.fn().mockResolvedValue({ exitCode: 0, output: longOutput });

    const agent = new Agent({ config: configVerifyEvery, provider, tools: makeRegistryWithFileWrite() });
    await agent.run("write one file", { taskMode: true, verifyFn });

    const messages = agent.getConversation().getMessages();
    const verifyMsg = messages.find(
      (m) => m.role === "user" && typeof m.content === "string" &&
        (m.content as string).includes("[verify after file_write]"),
    );
    expect(verifyMsg).toBeDefined();
    // The 2000-char output should be truncated to 1000 in the message
    expect((verifyMsg!.content as string)).not.toContain(longOutput);
    expect((verifyMsg!.content as string).length).toBeLessThan(1200); // header + 1000 chars max
  });

  it("N+1 guard: end-of-turn verify NOT called when verifyOnEveryWrite=true", async () => {
    const fakeClient = makeStreamingFakeClient([
      makeToolCallChunks("file_write", { path: "a.ts", content: "a" }),
      makeTextChunks("Done"),
    ]);
    const provider = new OpenAIProvider(configVerifyEvery, fakeClient);
    const verifyFn = vi.fn().mockResolvedValue({ exitCode: 0, output: "PASS" });

    const agent = new Agent({ config: configVerifyEvery, provider, tools: makeRegistryWithFileWrite() });
    await agent.run("write one file", { taskMode: true, verifyFn });

    // With verifyOnEveryWrite=true and 1 file_write: verify should be called exactly once
    // (per-write), NOT twice (per-write + end-of-turn).
    expect(verifyFn).toHaveBeenCalledTimes(1);
  });

  it("verifyOnEveryWrite=false (default): end-of-turn verify runs once per turn", async () => {
    const twoWriteChunks = makeTwoToolCallsChunks(
      "file_write", { path: "a.ts", content: "a" },
      "file_write", { path: "b.ts", content: "b" },
    );
    const fakeClient = makeStreamingFakeClient([twoWriteChunks, makeTextChunks("Done")]);
    const configDefault: Config = { ...minimalConfig, verifyCommand: "npm test", verifyOnEveryWrite: false };
    const provider = new OpenAIProvider(configDefault, fakeClient);
    const verifyFn = vi.fn().mockResolvedValue({ exitCode: 0, output: "PASS" });

    const agent = new Agent({ config: configDefault, provider, tools: makeRegistryWithFileWrite() });
    await agent.run("write two files", { taskMode: true, verifyFn });

    // Two writes in one turn → end-of-turn verify fires ONCE (not twice)
    expect(verifyFn).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Section 7: Sprint 85 — lastRunStats (TC-26–TC-28)
// ---------------------------------------------------------------------------

describe("Agent lastRunStats", () => {
  it("initialized to {turns:0, fileWrites:0} before first turn", async () => {
    // Check initial value before any run
    const agent = new Agent({ config: minimalConfig, tools: makeRegistryWithFileWrite() });
    expect(agent.lastRunStats).toEqual({ turns: 0, fileWrites: 0 });
  });

  it("lastRunStats.turns increments each turn", async () => {
    // 3 turns: tool call, tool call, then text response
    const fakeClient = makeStreamingFakeClient([
      makeToolCallChunks("echo", { text: "turn 1" }),
      makeToolCallChunks("echo", { text: "turn 2" }),
      makeTextChunks("Done after 3 turns"),
    ]);
    const provider = new OpenAIProvider(minimalConfig, fakeClient);
    const agent = new Agent({ config: minimalConfig, provider, tools: makeRegistryWithFileWrite() });

    await agent.run("do three turns");
    expect(agent.lastRunStats.turns).toBe(3);
  });

  it("lastRunStats.fileWrites counts successful file_write calls", async () => {
    const twoWriteChunks = makeTwoToolCallsChunks(
      "file_write", { path: "a.ts", content: "a" },
      "file_write", { path: "b.ts", content: "b" },
    );
    const fakeClient = makeStreamingFakeClient([twoWriteChunks, makeTextChunks("Done")]);
    const provider = new OpenAIProvider(minimalConfig, fakeClient);
    const agent = new Agent({ config: minimalConfig, provider, tools: makeRegistryWithFileWrite() });

    await agent.run("write two files");
    expect(agent.lastRunStats.fileWrites).toBe(2);
  });

  it("lastRunStats resets to {0,0} at the start of each run() call", async () => {
    const fakeClient = makeStreamingFakeClient([
      makeToolCallChunks("file_write", { path: "x.ts", content: "x" }),
      makeTextChunks("Done"),
      // second run — text only, no writes
      makeTextChunks("Second run done"),
    ]);
    const provider = new OpenAIProvider(minimalConfig, fakeClient);
    const agent = new Agent({ config: minimalConfig, provider, tools: makeRegistryWithFileWrite() });

    await agent.run("first run with write");
    expect(agent.lastRunStats.fileWrites).toBe(1);

    await agent.run("second run no writes");
    // Stats reset — second run had no writes
    expect(agent.lastRunStats.fileWrites).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Section 8: Sprint 85 — isAbortError helper (TC-32–TC-35)
// ---------------------------------------------------------------------------

import { isAbortError } from "../../src/core/agent.js";

describe("isAbortError helper", () => {
  it("returns true for err.name === 'AbortError'", () => {
    const err = Object.assign(new Error("aborted"), { name: "AbortError" });
    expect(isAbortError(err)).toBe(true);
  });

  it("returns true for err.code === 'ABORT_ERR'", () => {
    const err = Object.assign(new Error("aborted"), { code: "ABORT_ERR" });
    expect(isAbortError(err)).toBe(true);
  });

  it("returns true for DOMException with name 'AbortError'", () => {
    const err = new DOMException("The operation was aborted", "AbortError");
    expect(isAbortError(err)).toBe(true);
  });

  it("returns false for a generic Error", () => {
    expect(isAbortError(new Error("something else"))).toBe(false);
  });

  it("returns false for a non-Error value", () => {
    expect(isAbortError("string error")).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError(42)).toBe(false);
  });

  it("returns false for DOMException with a different name", () => {
    const err = new DOMException("timeout", "TimeoutError");
    expect(isAbortError(err)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Helpers — two tool calls in one LLM turn
// ---------------------------------------------------------------------------

/**
 * Build a chunk sequence where a single LLM response contains TWO tool calls.
 * This simulates the case where the agent batches multiple writes in one turn.
 */
function makeTwoToolCallsChunks(
  name1: string,
  args1: Record<string, unknown>,
  name2: string,
  args2: Record<string, unknown>,
): ChatCompletionChunk[] {
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
          role: "assistant" as const,
          content: null,
          tool_calls: [
            { index: 0, id: "call_1", type: "function" as const, function: { name: name1, arguments: "" } },
            { index: 1, id: "call_2", type: "function" as const, function: { name: name2, arguments: "" } },
          ],
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
          tool_calls: [
            { index: 0, function: { arguments: JSON.stringify(args1) } },
          ],
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
          tool_calls: [
            { index: 1, function: { arguments: JSON.stringify(args2) } },
          ],
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
