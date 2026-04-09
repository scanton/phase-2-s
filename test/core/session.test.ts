import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  migrateAll,
  cloneSession,
  saveSession,
  listSessions,
  readReplState,
  writeReplState,
  getSessionPreview,
  type SessionMeta,
} from "../../src/core/session.js";
import { Conversation } from "../../src/core/conversation.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sessionsDir(cwd: string) {
  return join(cwd, ".phase2s", "sessions");
}

function writeLegacySession(cwd: string, filename: string, messages: object[]) {
  const dir = sessionsDir(cwd);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, filename), JSON.stringify(messages, null, 2), "utf-8");
}

function readSession(path: string) {
  return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
}

function makeConv(...texts: string[]): Conversation {
  const c = new Conversation();
  texts.forEach((t, i) => (i % 2 === 0 ? c.addUser(t) : c.addAssistant(t)));
  return c;
}

function makeMeta(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    parentId: null,
    branchName: "main",
    createdAt: "2026-04-08T10:00:00.000Z",
    updatedAt: "2026-04-08T10:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// migrateAll()
// ---------------------------------------------------------------------------

describe("migrateAll()", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "phase2s-migrate-test-"));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("is a no-op when no sessions directory exists", async () => {
    await expect(migrateAll(tmpDir)).resolves.not.toThrow();
  });

  it("is a no-op when sessions directory is empty", async () => {
    mkdirSync(sessionsDir(tmpDir), { recursive: true });
    await migrateAll(tmpDir);
    // No backup dir created
    const phase2sDir = join(tmpDir, ".phase2s");
    const entries = require("node:fs").readdirSync(phase2sDir) as string[];
    expect(entries.some((e: string) => e.startsWith("sessions-backup"))).toBe(false);
  });

  it("is a no-op when sessions dir has no legacy (date-named) files", async () => {
    // UUID-named files should not trigger migration
    const dir = sessionsDir(tmpDir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "12345678-1234-1234-1234-123456789012.json"),
      JSON.stringify({ schemaVersion: 2, meta: {}, messages: [] }),
      "utf-8",
    );
    await migrateAll(tmpDir);
    expect(existsSync(join(dir, "migration.json"))).toBe(false);
  });

  it("creates a backup directory before touching any files", async () => {
    writeLegacySession(tmpDir, "2026-04-01.json", [{ role: "user", content: "hello" }]);
    await migrateAll(tmpDir);
    const phase2sDir = join(tmpDir, ".phase2s");
    const entries = require("node:fs").readdirSync(phase2sDir) as string[];
    const backupDirs = entries.filter((e: string) => e.startsWith("sessions-backup"));
    expect(backupDirs.length).toBe(1);
    // Backup should contain the original file
    const backupDir = join(phase2sDir, backupDirs[0]);
    expect(existsSync(join(backupDir, "2026-04-01.json"))).toBe(true);
  });

  it("renames legacy date files to UUID-named files", async () => {
    writeLegacySession(tmpDir, "2026-04-01.json", [{ role: "user", content: "hello" }]);
    await migrateAll(tmpDir);
    const dir = sessionsDir(tmpDir);
    const entries = require("node:fs").readdirSync(dir) as string[];
    const uuidFiles = entries.filter((e: string) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/i.test(e),
    );
    expect(uuidFiles.length).toBeGreaterThanOrEqual(1);
  });

  it("writes schemaVersion: 2 in migrated files", async () => {
    writeLegacySession(tmpDir, "2026-04-01.json", [{ role: "user", content: "hello" }]);
    await migrateAll(tmpDir);
    const dir = sessionsDir(tmpDir);
    const entries = require("node:fs").readdirSync(dir) as string[];
    const uuidFile = entries.find((e: string) =>
      /^[0-9a-f-]+\.json$/.test(e) && !e.includes("migration"),
    );
    expect(uuidFile).toBeTruthy();
    const parsed = readSession(join(dir, uuidFile!));
    expect(parsed.schemaVersion).toBe(2);
    expect((parsed.meta as SessionMeta).parentId).toBeNull();
    expect((parsed.meta as SessionMeta).branchName).toBe("main");
    expect(Array.isArray(parsed.messages)).toBe(true);
  });

  it("writes migration manifest tracking per-file completion", async () => {
    writeLegacySession(tmpDir, "2026-04-01.json", []);
    writeLegacySession(tmpDir, "2026-04-02.json", []);
    await migrateAll(tmpDir);
    const manifest = JSON.parse(
      readFileSync(join(sessionsDir(tmpDir), "migration.json"), "utf-8"),
    ) as { entries: Array<{ done: boolean }> };
    expect(manifest.entries.length).toBe(2);
    expect(manifest.entries.every((e) => e.done)).toBe(true);
  });

  it("is idempotent: running again does not duplicate work", async () => {
    writeLegacySession(tmpDir, "2026-04-01.json", [{ role: "user", content: "hello" }]);
    await migrateAll(tmpDir);
    await migrateAll(tmpDir); // second run — should be a no-op

    const dir = sessionsDir(tmpDir);
    const entries = require("node:fs").readdirSync(dir) as string[];
    const uuidFiles = entries.filter((e: string) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/i.test(e),
    );
    // Still exactly one migrated file
    expect(uuidFiles.length).toBe(1);
  });

  it("resumes an interrupted migration using the manifest", async () => {
    writeLegacySession(tmpDir, "2026-04-01.json", []);
    writeLegacySession(tmpDir, "2026-04-02.json", []);

    // Simulate interrupted migration: manifest says file 1 is done, file 2 is not
    const fakeId1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const partialManifest = {
      version: 1,
      entries: [
        { originalName: "2026-04-01.json", newId: fakeId1, done: true },
        { originalName: "2026-04-02.json", newId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", done: false },
      ],
    };
    const dir = sessionsDir(tmpDir);
    // Write the manifest
    writeFileSync(join(dir, "migration.json"), JSON.stringify(partialManifest), "utf-8");
    // Write the already-migrated file for entry 1
    writeFileSync(
      join(dir, `${fakeId1}.json`),
      JSON.stringify({ schemaVersion: 2, meta: { id: fakeId1, parentId: null, branchName: "main", createdAt: "", updatedAt: "" }, messages: [] }),
      "utf-8",
    );

    await migrateAll(tmpDir);

    // Both UUIDs should now exist as v2 files
    expect(existsSync(join(dir, `${fakeId1}.json`))).toBe(true);
    expect(existsSync(join(dir, "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.json"))).toBe(true);
    const manifest2 = JSON.parse(readFileSync(join(dir, "migration.json"), "utf-8")) as { entries: Array<{ done: boolean }> };
    expect(manifest2.entries.every((e) => e.done)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// cloneSession()
// ---------------------------------------------------------------------------

describe("cloneSession()", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "phase2s-clone-test-"));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  async function writeV2Session(id: string, messages: object[], parentId: string | null = null) {
    const dir = sessionsDir(tmpDir);
    mkdirSync(dir, { recursive: true });
    const now = new Date().toISOString();
    writeFileSync(
      join(dir, `${id}.json`),
      JSON.stringify({
        schemaVersion: 2,
        meta: { id, parentId, branchName: "main", createdAt: now, updatedAt: now },
        messages,
      }, null, 2),
      { encoding: "utf-8", mode: 0o600 },
    );
  }

  it("creates a new session file with a different UUID", async () => {
    const sourceId = "11111111-1111-1111-1111-111111111111";
    await writeV2Session(sourceId, [{ role: "user", content: "hello" }]);
    const result = await cloneSession(tmpDir, sourceId);
    expect(result.id).not.toBe(sourceId);
    expect(existsSync(result.path)).toBe(true);
  });

  it("sets parentId to the source session id", async () => {
    const sourceId = "11111111-1111-1111-1111-111111111111";
    await writeV2Session(sourceId, []);
    const result = await cloneSession(tmpDir, sourceId);
    const parsed = readSession(result.path);
    expect((parsed.meta as SessionMeta).parentId).toBe(sourceId);
  });

  it("deep-copies messages (no shared reference)", async () => {
    const sourceId = "22222222-2222-2222-2222-222222222222";
    const msgs = [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }];
    await writeV2Session(sourceId, msgs);
    const result = await cloneSession(tmpDir, sourceId);
    const parsed = readSession(result.path);
    expect(parsed.messages).toEqual(msgs);
    expect(result.messageCount).toBe(2);
  });

  it("uses provided branchName", async () => {
    const sourceId = "33333333-3333-3333-3333-333333333333";
    await writeV2Session(sourceId, []);
    const result = await cloneSession(tmpDir, sourceId, "feature/retry");
    const parsed = readSession(result.path);
    expect((parsed.meta as SessionMeta).branchName).toBe("feature/retry");
  });

  it("defaults branchName to fork-YYYY-MM-DD when not provided", async () => {
    const sourceId = "44444444-4444-4444-4444-444444444444";
    await writeV2Session(sourceId, []);
    const result = await cloneSession(tmpDir, sourceId);
    const parsed = readSession(result.path);
    const branchName = (parsed.meta as SessionMeta).branchName;
    expect(branchName).toMatch(/^fork-\d{4}-\d{2}-\d{2}$/);
  });

  it("throws when source session does not exist", async () => {
    await expect(
      cloneSession(tmpDir, "nonexistent-id-that-does-not-exist"),
    ).rejects.toThrow(/not found/i);
  });

  it("supports clone of clone (grandchild parentId chain)", async () => {
    const rootId = "root0000-0000-0000-0000-000000000000";
    await writeV2Session(rootId, [{ role: "user", content: "root" }]);

    // Clone root → child
    const child = await cloneSession(tmpDir, rootId, "child");
    // Clone child → grandchild
    const grandchild = await cloneSession(tmpDir, child.id, "grandchild");

    const childParsed = readSession(child.path);
    const grandchildParsed = readSession(grandchild.path);

    expect((childParsed.meta as SessionMeta).parentId).toBe(rootId);
    expect((grandchildParsed.meta as SessionMeta).parentId).toBe(child.id);
  });
});

// ---------------------------------------------------------------------------
// saveSession() + loadSession()
// ---------------------------------------------------------------------------

describe("saveSession()", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "phase2s-save-test-"));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes schemaVersion: 2 format", async () => {
    const conv = makeConv("hello", "hi there");
    const meta = makeMeta();
    const path = join(tmpDir, "session.json");
    await saveSession(path, conv, meta);
    const parsed = readSession(path);
    expect(parsed.schemaVersion).toBe(2);
    expect(Array.isArray(parsed.messages)).toBe(true);
    expect((parsed.messages as object[]).length).toBe(2);
  });

  it("updates updatedAt on each save", async () => {
    const conv = makeConv("hello");
    const meta = makeMeta({ updatedAt: "2026-01-01T00:00:00.000Z" });
    const path = join(tmpDir, "session.json");
    await saveSession(path, conv, meta);
    const parsed = readSession(path);
    expect((parsed.meta as SessionMeta).updatedAt).not.toBe("2026-01-01T00:00:00.000Z");
  });

  it("creates parent directories if needed", async () => {
    const conv = makeConv("test");
    const path = join(tmpDir, "deep", "nested", "session.json");
    await saveSession(path, conv, makeMeta());
    expect(existsSync(path)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// readReplState() / writeReplState()
// ---------------------------------------------------------------------------

describe("readReplState() / writeReplState()", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "phase2s-state-test-"));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null when state.json does not exist", () => {
    expect(readReplState(tmpDir)).toBeNull();
  });

  it("roundtrips currentSessionId", () => {
    writeReplState(tmpDir, { currentSessionId: "abc-123" });
    const state = readReplState(tmpDir);
    expect(state?.currentSessionId).toBe("abc-123");
  });

  it("overwrites previous state", () => {
    writeReplState(tmpDir, { currentSessionId: "first" });
    writeReplState(tmpDir, { currentSessionId: "second" });
    expect(readReplState(tmpDir)?.currentSessionId).toBe("second");
  });
});

// ---------------------------------------------------------------------------
// getSessionPreview()
// ---------------------------------------------------------------------------

describe("getSessionPreview()", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "phase2s-preview-test-"));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns first user message content", async () => {
    const path = join(tmpDir, "s.json");
    writeFileSync(
      path,
      JSON.stringify({
        schemaVersion: 2,
        meta: makeMeta(),
        messages: [
          { role: "system", content: "system msg" },
          { role: "user", content: "hello world" },
        ],
      }),
    );
    const preview = await getSessionPreview(path);
    expect(preview).toBe("hello world");
  });

  it("strips ANSI escape codes from preview", async () => {
    const path = join(tmpDir, "s.json");
    writeFileSync(
      path,
      JSON.stringify({
        schemaVersion: 2,
        meta: makeMeta(),
        messages: [{ role: "user", content: "\x1b[32mgreen text\x1b[0m" }],
      }),
    );
    const preview = await getSessionPreview(path);
    expect(preview).not.toContain("\x1b");
    expect(preview).toContain("green text");
  });

  it("returns empty string for corrupted file", async () => {
    const path = join(tmpDir, "bad.json");
    writeFileSync(path, "not json at all");
    const preview = await getSessionPreview(path);
    expect(preview).toBe("");
  });
});
