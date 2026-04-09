import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, stat } from "node:fs/promises";
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

  it("save() with mode: 0o600 writes file with owner-only permissions", async () => {
    const c = new Conversation("sys");
    c.addUser("sensitive data");

    const path = join(tmpDir, "session-secure.json");
    await c.save(path, 0o600);

    const info = await stat(path);
    // Mask with 0o777 to extract only the permission bits
    const perms = info.mode & 0o777;
    expect(perms).toBe(0o600);
  });

  it("save() without mode uses default (world-readable) permissions", async () => {
    const c = new Conversation("sys");
    c.addUser("data");

    const path = join(tmpDir, "session-default.json");
    await c.save(path);

    // File should exist and be readable — the default mode is not constrained
    const info = await stat(path);
    expect(info.size).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Dual-format load() — v1 (legacy array) and v2 ({schemaVersion: 2})
// ---------------------------------------------------------------------------

describe("Conversation.load() dual-format", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(process.cwd(), ".test-conv-dual-"));
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true }).catch(() => {});
  });

  it("loads v1 format (legacy bare array) correctly", async () => {
    const { writeFile } = await import("node:fs/promises");
    const path = join(tmpDir, "v1.json");
    await writeFile(
      path,
      JSON.stringify([
        { role: "user", content: "hello from v1" },
        { role: "assistant", content: "hi from v1" },
      ]),
    );
    const conv = await Conversation.load(path);
    expect(conv.length).toBe(2);
    expect(conv.getMessages()[0].content).toBe("hello from v1");
  });

  it("loads v2 format ({schemaVersion: 2, meta, messages}) correctly", async () => {
    const { writeFile } = await import("node:fs/promises");
    const path = join(tmpDir, "v2.json");
    await writeFile(
      path,
      JSON.stringify({
        schemaVersion: 2,
        meta: {
          id: "test-uuid",
          parentId: null,
          branchName: "main",
          createdAt: "2026-04-08T00:00:00.000Z",
          updatedAt: "2026-04-08T00:00:00.000Z",
        },
        messages: [
          { role: "user", content: "hello from v2" },
          { role: "assistant", content: "hi from v2" },
        ],
      }),
    );
    const conv = await Conversation.load(path);
    expect(conv.length).toBe(2);
    expect(conv.getMessages()[0].content).toBe("hello from v2");
  });

  it("loads v2 format with null parentId without error", async () => {
    const { writeFile } = await import("node:fs/promises");
    const path = join(tmpDir, "v2-null-parent.json");
    await writeFile(
      path,
      JSON.stringify({
        schemaVersion: 2,
        meta: { id: "x", parentId: null, branchName: "main", createdAt: "", updatedAt: "" },
        messages: [{ role: "user", content: "test" }],
      }),
    );
    const conv = await Conversation.load(path);
    expect(conv.length).toBe(1);
  });

  it("throws on unrecognized format (plain object, no schemaVersion)", async () => {
    const { writeFile } = await import("node:fs/promises");
    const path = join(tmpDir, "unknown.json");
    await writeFile(path, JSON.stringify({ someRandomKey: "value" }));
    await expect(Conversation.load(path)).rejects.toThrow(/unrecognized format/);
  });

  it("still rejects invalid message roles in v2 format", async () => {
    const { writeFile } = await import("node:fs/promises");
    const path = join(tmpDir, "v2-bad-role.json");
    await writeFile(
      path,
      JSON.stringify({
        schemaVersion: 2,
        meta: { id: "x", parentId: null, branchName: "main", createdAt: "", updatedAt: "" },
        messages: [{ role: "admin", content: "injected" }],
      }),
    );
    await expect(Conversation.load(path)).rejects.toThrow(/invalid role/i);
  });
});
