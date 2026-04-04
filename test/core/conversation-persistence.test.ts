import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { Conversation } from "../../src/core/conversation.js";

/**
 * Tests for Conversation.save() and Conversation.load() — session persistence.
 */
describe("Conversation persistence", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(process.cwd(), ".test-conv-persist-"));
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true }).catch(() => {});
  });

  it("save() writes a JSON file and load() restores the conversation", async () => {
    const c = new Conversation("You are a test assistant");
    c.addUser("Hello");
    c.addAssistant("Hi there");

    const path = join(tmpDir, "session.json");
    await c.save(path);

    const loaded = await Conversation.load(path);
    const msgs = loaded.getMessages();

    expect(msgs).toHaveLength(3);
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toBe("You are a test assistant");
    expect(msgs[1].role).toBe("user");
    expect(msgs[1].content).toBe("Hello");
    expect(msgs[2].role).toBe("assistant");
    expect(msgs[2].content).toBe("Hi there");
  });

  it("save/load roundtrip preserves tool calls and tool results", async () => {
    const c = new Conversation();
    c.addUser("run a tool");
    c.addAssistant("", [{ id: "call-1", name: "file_read", arguments: '{"path":"foo.ts"}' }]);
    c.addToolResult("call-1", "file contents here");

    const path = join(tmpDir, "session-tools.json");
    await c.save(path);

    const loaded = await Conversation.load(path);
    const msgs = loaded.getMessages();

    expect(msgs).toHaveLength(3);
    expect(msgs[1].role).toBe("assistant");
    expect(msgs[1].toolCalls).toHaveLength(1);
    expect(msgs[1].toolCalls![0].name).toBe("file_read");
    expect(msgs[2].role).toBe("tool");
    expect(msgs[2].toolCallId).toBe("call-1");
  });

  it("save() creates parent directories if they don't exist", async () => {
    const c = new Conversation("sys");
    c.addUser("test");

    const nestedPath = join(tmpDir, "nested", "deep", "session.json");
    await c.save(nestedPath); // should not throw

    const loaded = await Conversation.load(nestedPath);
    expect(loaded.length).toBe(2);
  });

  it("load() throws a clear error when the file doesn't exist", async () => {
    await expect(Conversation.load(join(tmpDir, "nonexistent.json"))).rejects.toThrow();
  });

  it("load() throws when file contains invalid JSON", async () => {
    const { writeFile } = await import("node:fs/promises");
    const badPath = join(tmpDir, "bad.json");
    await writeFile(badPath, "not valid json {{{{", "utf-8");
    await expect(Conversation.load(badPath)).rejects.toThrow();
  });

  it("load() throws when JSON is valid but not an array", async () => {
    const { writeFile } = await import("node:fs/promises");
    const badPath = join(tmpDir, "not-array.json");
    await writeFile(badPath, '{"not": "an array"}', "utf-8");
    await expect(Conversation.load(badPath)).rejects.toThrow("Invalid session file");
  });

  it("load() rejects messages with invalid role (prompt injection guard)", async () => {
    const { writeFile } = await import("node:fs/promises");
    const badPath = join(tmpDir, "bad-role.json");
    // Crafted session: inject a message with an unknown role to test validation
    await writeFile(badPath, JSON.stringify([
      { role: "system", content: "real system" },
      { role: "INJECTED_ROLE", content: "malicious override" },
    ]), "utf-8");
    await expect(Conversation.load(badPath)).rejects.toThrow("invalid role");
  });

  it("load() rejects messages that are not objects", async () => {
    const { writeFile } = await import("node:fs/promises");
    const badPath = join(tmpDir, "bad-message.json");
    await writeFile(badPath, JSON.stringify([null, "string", 42]), "utf-8");
    await expect(Conversation.load(badPath)).rejects.toThrow("is not an object");
  });

  it("loaded conversation has correct length and is functional after load", async () => {
    const c = new Conversation("sys");
    c.addUser("msg1");
    c.addUser("msg2");

    const path = join(tmpDir, "session-length.json");
    await c.save(path);

    const loaded = await Conversation.load(path);
    expect(loaded.length).toBe(3); // sys + 2 user

    // Should be usable — can add more messages
    loaded.addAssistant("reply");
    expect(loaded.length).toBe(4);
  });
});
