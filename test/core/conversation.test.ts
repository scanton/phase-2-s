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
});
