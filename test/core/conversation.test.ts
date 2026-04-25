import { describe, it, expect } from "vitest";
import { Conversation } from "../../src/core/conversation.js";

describe("Conversation", () => {
  // --- Construction ---

  it("initializes with a system message when provided", () => {
    const c = new Conversation("You are a helpful assistant");
    const msgs = c.getMessages();
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toBe("You are a helpful assistant");
  });

  it("initializes empty when no system prompt given", () => {
    const c = new Conversation();
    expect(c.getMessages()).toHaveLength(0);
    expect(c.length).toBe(0);
  });

  // --- Message ordering ---

  it("preserves insertion order for user and assistant messages", () => {
    const c = new Conversation();
    c.addUser("hello");
    c.addAssistant("hi there");
    c.addUser("how are you");
    const msgs = c.getMessages();
    expect(msgs[0].role).toBe("user");
    expect(msgs[0].content).toBe("hello");
    expect(msgs[1].role).toBe("assistant");
    expect(msgs[2].role).toBe("user");
  });

  it("adds tool results with toolCallId", () => {
    const c = new Conversation();
    c.addToolResult("call-abc-123", "file contents here");
    const msgs = c.getMessages();
    expect(msgs[0].role).toBe("tool");
    expect(msgs[0].toolCallId).toBe("call-abc-123");
    expect(msgs[0].content).toBe("file contents here");
  });

  // --- Immutability ---

  it("getMessages returns a defensive copy", () => {
    const c = new Conversation("system");
    const msgs = c.getMessages();
    msgs.push({ role: "user", content: "injected" });
    // Internal state must be unchanged
    expect(c.getMessages()).toHaveLength(1);
    expect(c.length).toBe(1);
  });

  // --- Token estimation ---

  it("estimates tokens proportionally to content length", () => {
    const c = new Conversation();
    c.addUser("aaaa"); // 4 chars = 1 token
    expect(c.estimateTokens()).toBe(1);
  });

  it("does not crash when assistant content is empty string", () => {
    const c = new Conversation();
    // Simulate a tool-call-only assistant turn (content is empty, has toolCalls)
    c.addAssistant("", [{ id: "c1", name: "shell", arguments: '{"command":"ls"}' }]);
    expect(() => c.estimateTokens()).not.toThrow();
    expect(c.estimateTokens()).toBeGreaterThanOrEqual(0);
  });

  it("accumulates token estimates across multiple messages", () => {
    const c = new Conversation();
    c.addUser("aaaa");       // 1 token
    c.addAssistant("bbbbbbbb"); // 2 tokens
    expect(c.estimateTokens()).toBe(3);
  });

  // --- Token budget trimming ---

  it("trims oldest tool results when over budget", () => {
    const c = new Conversation("system");
    c.addUser("user message");
    const bigContent = "x".repeat(100_000); // ~25k tokens each
    c.addToolResult("t1", bigContent);
    c.addToolResult("t2", bigContent);
    c.addToolResult("t3", bigContent);

    const beforeLen = c.length;
    c.trimToTokenBudget(10_000);

    expect(c.length).toBeLessThan(beforeLen);
  });

  it("drops entire assistant+tool turn atomically to avoid orphaned tool_call pairs", () => {
    const c = new Conversation("system");
    c.addUser("hello");
    // Simulate a tool-calling turn: assistant issues calls, results follow
    c.addAssistant("", [
      { id: "c1", name: "shell", arguments: '{"command":"ls"}' },
      { id: "c2", name: "file_read", arguments: '{"path":"foo.ts"}' },
    ]);
    c.addToolResult("c1", "x".repeat(100_000)); // big result
    c.addToolResult("c2", "x".repeat(100_000)); // big result
    c.addAssistant("Done."); // final response — no toolCalls

    c.trimToTokenBudget(1_000);

    const msgs = c.getMessages();
    // The assistant+tool turn must be gone entirely — no orphaned tool results
    const hasToolResult = msgs.some((m) => m.role === "tool");
    const hasToolCallAssistant = msgs.some(
      (m) => m.role === "assistant" && m.toolCalls?.length,
    );
    // Both must be absent or both must be present (never one without the other)
    expect(hasToolResult).toBe(hasToolCallAssistant);
    // System and user messages must survive
    expect(msgs.some((m) => m.role === "system")).toBe(true);
    expect(msgs.some((m) => m.role === "user")).toBe(true);
  });

  it("preserves system and user messages when trimming", () => {
    const c = new Conversation("important system prompt");
    c.addUser("important user request");
    c.addToolResult("t1", "x".repeat(500_000)); // blows any reasonable budget

    c.trimToTokenBudget(1_000);

    const msgs = c.getMessages();
    const system = msgs.find((m) => m.role === "system");
    const user = msgs.find((m) => m.role === "user");
    expect(system?.content).toBe("important system prompt");
    expect(user?.content).toBe("important user request");
  });

  it("stops trimming when no tool results remain", () => {
    const c = new Conversation();
    c.addUser("only user message, no tool results");
    // This should not throw or infinite-loop even when over budget
    expect(() => c.trimToTokenBudget(1)).not.toThrow();
  });

  it("does not trim when under budget", () => {
    const c = new Conversation("system");
    c.addUser("hello");
    c.addAssistant("hi");
    c.addToolResult("t1", "small result");

    const lenBefore = c.length;
    c.trimToTokenBudget(128_000 * 0.8); // default budget
    expect(c.length).toBe(lenBefore);
  });

  // --- fromMessages() ---

  it("fromMessages() creates a conversation with exactly the given messages", () => {
    const msgs = [
      { role: "system" as const, content: "You are a helper" },
      { role: "user" as const, content: "hello" },
      { role: "assistant" as const, content: "hi" },
    ];
    const c = Conversation.fromMessages(msgs);
    expect(c.getMessages()).toHaveLength(3);
    expect(c.getMessages()[0].role).toBe("system");
    expect(c.getMessages()[1].content).toBe("hello");
    expect(c.getMessages()[2].content).toBe("hi");
  });

  it("fromMessages() copies the array — mutations do not affect the conversation", () => {
    const msgs = [{ role: "user" as const, content: "original" }];
    const c = Conversation.fromMessages(msgs);
    msgs[0] = { role: "user" as const, content: "mutated" };
    expect(c.getMessages()[0].content).toBe("original");
  });

  it("fromMessages() with empty array produces an empty conversation", () => {
    const c = Conversation.fromMessages([]);
    expect(c.getMessages()).toHaveLength(0);
    expect(c.length).toBe(0);
  });

  // --- upsertLearningsMessage() — Sprint 73 (Item E) ---

  it("inserts just before the last user message (current pending turn)", () => {
    const c = new Conversation("system prompt");
    c.addUser("user message");
    c.upsertLearningsMessage("[PHASE2S_LEARNINGS]\nsome learning");

    const msgs = c.getMessages();
    expect(msgs[0].role).toBe("system");
    expect(msgs[1].role).toBe("user");
    expect(msgs[1].content).toContain(Conversation.LEARNINGS_MARKER);
    expect(msgs[2].role).toBe("user");
    expect(msgs[2].content).toBe("user message");
  });

  it("inserts before the last user message when no system message is present", () => {
    const c = new Conversation();
    c.addUser("hello");
    c.upsertLearningsMessage("[PHASE2S_LEARNINGS]\nno system message");

    const msgs = c.getMessages();
    expect(msgs[0].content).toContain(Conversation.LEARNINGS_MARKER);
    expect(msgs[1].content).toBe("hello");
  });

  it("re-positions learnings before the current last user message on second call", () => {
    const c = new Conversation("system");
    c.upsertLearningsMessage("[PHASE2S_LEARNINGS]\nfirst learnings");
    c.addUser("user turn 1");
    c.upsertLearningsMessage("[PHASE2S_LEARNINGS]\nupdated learnings");

    const msgs = c.getMessages();
    const learningsMessages = msgs.filter(
      (m) => m.role === "user" && (m.content ?? "").startsWith(Conversation.LEARNINGS_MARKER),
    );
    expect(learningsMessages).toHaveLength(1);
    expect(learningsMessages[0].content).toContain("updated learnings");
    expect(learningsMessages[0].content).not.toContain("first learnings");
    // Position: LEARNINGS must be immediately before the last user message
    const learnIdx = msgs.findIndex((m) => m.role === "user" && (m.content ?? "").startsWith(Conversation.LEARNINGS_MARKER));
    const lastUserIdx = msgs.map((m) => m.role).lastIndexOf("user");
    expect(learnIdx).toBe(lastUserIdx - 1);
  });

  it("does not affect trimToTokenBudget — learnings message is not a tool result and is not trimmed", () => {
    const c = new Conversation("system");
    c.upsertLearningsMessage("[PHASE2S_LEARNINGS]\nsome learning");
    c.addAssistant("", [{ id: "c1", name: "shell", arguments: '{"command":"ls"}' }]);
    c.addToolResult("c1", "x".repeat(100_000));

    c.trimToTokenBudget(1_000);

    const msgs = c.getMessages();
    const learningsMsg = msgs.find(
      (m) => m.role === "user" && (m.content ?? "").startsWith(Conversation.LEARNINGS_MARKER),
    );
    expect(learningsMsg).toBeDefined();
  });

  it("in a multi-turn conversation, LEARNINGS moves to just before the last user message (not the first)", () => {
    // Reproduces the adversarial-review bug: in a conversation with history,
    // upsertLearningsMessage() must NOT stay anchored to index 1 (after system).
    // Otherwise translateMessages() merges LEARNINGS with a historical user message.
    const c = new Conversation("sys");
    c.addUser("turn 1 question");
    c.addAssistant("turn 1 answer");
    c.addUser("turn 2 question");

    c.upsertLearningsMessage("[PHASE2S_LEARNINGS]\nlearning text");

    const msgs = c.getMessages();
    // LEARNINGS must appear immediately before "turn 2 question" (the last user turn),
    // NOT before "turn 1 question" (the first historical user turn).
    const learnIdx = msgs.findIndex(
      (m) => m.role === "user" && (m.content ?? "").startsWith(Conversation.LEARNINGS_MARKER),
    );
    const lastUserIdx = msgs.map((m) => m.role).lastIndexOf("user");
    expect(learnIdx).toBe(lastUserIdx - 1);
    expect(msgs[lastUserIdx].content).toBe("turn 2 question");
  });

  it("LEARNINGS_MARKER is the expected sentinel string", () => {
    expect(Conversation.LEARNINGS_MARKER).toBe("[PHASE2S_LEARNINGS]");
  });
});
