import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  migrateAll,
  cloneSession,
  saveSession,
  listSessions,
  readReplState,
  writeReplState,
  readSessionIndex,
  upsertSessionIndex,
  rebuildSessionIndex,
  releasePosixLock,
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
// migrateAll() — lockfile + path traversal guards (Phase 2)
// ---------------------------------------------------------------------------

describe("migrateAll() — lockfile", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "phase2s-lock-test-"));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("skips and warns when lock file is already present (concurrent migration guard)", async () => {
    // Pre-seed the lockfile to simulate another process holding the migration lock.
    // (Two actual concurrent Node.js calls in the same process won't race —
    // single-threaded; the pre-seeded approach is the reliable way to test this path.)
    const dir = sessionsDir(tmpDir);
    mkdirSync(dir, { recursive: true });
    // Write a legacy file so migration would normally run
    writeLegacySession(tmpDir, "2026-04-01.json", [{ role: "user", content: "hello" }]);
    // Place the lock file before calling migrateAll
    const lockPath = join(dir, "migration.json.lock");
    writeFileSync(lockPath, "", "utf-8");

    const stderrMessages: string[] = [];
    const origConsoleError = console.error;
    console.error = (...args: unknown[]) => stderrMessages.push(String(args[0]));
    try {
      await migrateAll(tmpDir);
    } finally {
      console.error = origConsoleError;
    }

    // Migration should have been skipped — no manifest written
    expect(existsSync(join(dir, "migration.json"))).toBe(false);
    // Warning should have been emitted
    expect(stderrMessages.some((m) => /already in progress/i.test(m))).toBe(true);

    // Clean up lock so afterEach rmSync works cleanly
    unlinkSync(lockPath);
  });

  it("releases the lock after successful migration", async () => {
    writeLegacySession(tmpDir, "2026-04-01.json", []);
    await migrateAll(tmpDir);
    const lockPath = join(sessionsDir(tmpDir), "migration.json.lock");
    expect(existsSync(lockPath)).toBe(false);
  });
});

describe("migrateAll() — path traversal guards", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "phase2s-traversal-test-"));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("skips manifest entries with path-traversal originalName", async () => {
    const dir = sessionsDir(tmpDir);
    mkdirSync(dir, { recursive: true });
    // Write a crafted manifest with a traversal path
    const maliciousManifest = {
      version: 1,
      entries: [
        { originalName: "../../evil.json", newId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", done: false },
      ],
    };
    writeFileSync(join(dir, "migration.json"), JSON.stringify(maliciousManifest), "utf-8");
    // Should not throw and should not write anything outside sessions dir
    await expect(migrateAll(tmpDir)).resolves.not.toThrow();
    // The traversal target should not have been created
    expect(existsSync(join(tmpDir, "evil.json"))).toBe(false);
  });

  it("skips manifest entries with non-UUID newId", async () => {
    const dir = sessionsDir(tmpDir);
    mkdirSync(dir, { recursive: true });
    // Write a legacy file so the entry would otherwise be processed
    writeLegacySession(tmpDir, "2026-04-01.json", [{ role: "user", content: "hello" }]);
    const craftyManifest = {
      version: 1,
      entries: [
        { originalName: "2026-04-01.json", newId: "../../evil", done: false },
      ],
    };
    writeFileSync(join(dir, "migration.json"), JSON.stringify(craftyManifest), "utf-8");
    await expect(migrateAll(tmpDir)).resolves.not.toThrow();
    // No file at the traversal path should exist
    expect(existsSync(join(tmpDir, "evil.json"))).toBe(false);
    expect(existsSync(join(tmpDir, "..", "evil"))).toBe(false);
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
    await saveSession(tmpDir, path, conv, meta);
    const parsed = readSession(path);
    expect(parsed.schemaVersion).toBe(2);
    expect(Array.isArray(parsed.messages)).toBe(true);
    expect((parsed.messages as object[]).length).toBe(2);
  });

  it("updates updatedAt on each save", async () => {
    const conv = makeConv("hello");
    const meta = makeMeta({ updatedAt: "2026-01-01T00:00:00.000Z" });
    const path = join(tmpDir, "session.json");
    await saveSession(tmpDir, path, conv, meta);
    const parsed = readSession(path);
    expect((parsed.meta as SessionMeta).updatedAt).not.toBe("2026-01-01T00:00:00.000Z");
  });

  it("creates parent directories if needed", async () => {
    const conv = makeConv("test");
    const path = join(tmpDir, "deep", "nested", "session.json");
    await saveSession(tmpDir, path, conv, makeMeta());
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

  it("roundtrips currentSessionId", async () => {
    await writeReplState(tmpDir, { currentSessionId: "abc-123" });
    const state = readReplState(tmpDir);
    expect(state?.currentSessionId).toBe("abc-123");
  });

  it("overwrites previous state", async () => {
    await writeReplState(tmpDir, { currentSessionId: "first" });
    await writeReplState(tmpDir, { currentSessionId: "second" });
    expect(readReplState(tmpDir)?.currentSessionId).toBe("second");
  });
});

// ---------------------------------------------------------------------------
// writeReplState() — POSIX lock
// ---------------------------------------------------------------------------

describe("writeReplState() lock", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "phase2s-lock-test-"));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes state.json atomically", async () => {
    await writeReplState(tmpDir, { currentSessionId: "abc-123" });
    const state = readReplState(tmpDir);
    expect(state?.currentSessionId).toBe("abc-123");
  });

  it("overwrites existing state.json", async () => {
    await writeReplState(tmpDir, { currentSessionId: "first" });
    await writeReplState(tmpDir, { currentSessionId: "second" });
    expect(readReplState(tmpDir)?.currentSessionId).toBe("second");
  });

  it("releases lock file after write", async () => {
    await writeReplState(tmpDir, { currentSessionId: "abc" });
    const lockPath = join(tmpDir, ".phase2s", ".state.lock");
    expect(existsSync(lockPath)).toBe(false);
  });

  it("removes stale lock (older than 30s) before acquiring", async () => {
    // Create a stale lock (mtime in the past)
    const phase2sDir = join(tmpDir, ".phase2s");
    mkdirSync(phase2sDir, { recursive: true });
    const lockPath = join(phase2sDir, ".state.lock");
    writeFileSync(lockPath, "99999"); // stale: mtime = now, but we'll backdate it

    // Manually set mtime to 60 seconds ago via utime
    const { utimesSync } = await import("node:fs");
    const sixtySecsAgo = (Date.now() - 60_000) / 1000;
    utimesSync(lockPath, sixtySecsAgo, sixtySecsAgo);

    // Should succeed (stale lock removed) without throwing
    await expect(writeReplState(tmpDir, { currentSessionId: "after-stale" })).resolves.not.toThrow();
    expect(readReplState(tmpDir)?.currentSessionId).toBe("after-stale");
  });

  it("proceeds without lock when contended (retry-once path)", async () => {
    // Simulate contention: create a fresh lock file that won't be removed
    const phase2sDir = join(tmpDir, ".phase2s");
    mkdirSync(phase2sDir, { recursive: true });
    const lockPath = join(phase2sDir, ".state.lock");
    writeFileSync(lockPath, "99999"); // fresh lock (not stale)

    try {
      // writeReplState should still write state.json even without winning the lock
      await expect(writeReplState(tmpDir, { currentSessionId: "contended" })).resolves.not.toThrow();
      expect(readReplState(tmpDir)?.currentSessionId).toBe("contended");
    } finally {
      // Always clean up the contention lock so it doesn't pollute other tests
      try { unlinkSync(lockPath); } catch { /* already removed */ }
    }
  });
});

// ---------------------------------------------------------------------------
// Session index — upsertSessionIndex / readSessionIndex / listSessions
// ---------------------------------------------------------------------------

describe("upsertSessionIndex()", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "phase2s-index-test-"));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates the index on first upsert", async () => {
    const meta = makeMeta();
    await upsertSessionIndex(tmpDir, meta, "hello world");
    const index = await readSessionIndex(tmpDir);
    expect(index).not.toBeNull();
    expect(index!.version).toBe(1);
    expect(index!.sessions[meta.id]).toBeDefined();
    expect(index!.sessions[meta.id].firstMessage).toBe("hello world");
  });

  it("merges without overwriting existing entries", async () => {
    const meta1 = makeMeta({ id: "00000000-0000-0000-0000-000000000001" });
    const meta2 = makeMeta({ id: "00000000-0000-0000-0000-000000000002" });
    await upsertSessionIndex(tmpDir, meta1, "first session");
    await upsertSessionIndex(tmpDir, meta2, "second session");
    const index = await readSessionIndex(tmpDir);
    expect(Object.keys(index!.sessions)).toHaveLength(2);
    expect(index!.sessions[meta1.id].firstMessage).toBe("first session");
    expect(index!.sessions[meta2.id].firstMessage).toBe("second session");
  });

  it("stores parentId in the index entry", async () => {
    const meta = makeMeta({
      id: "00000000-0000-0000-0000-000000000002",
      parentId: "00000000-0000-0000-0000-000000000001",
    });
    await upsertSessionIndex(tmpDir, meta, "child session");
    const index = await readSessionIndex(tmpDir);
    expect(index!.sessions[meta.id].parentId).toBe("00000000-0000-0000-0000-000000000001");
  });
});

describe("readSessionIndex()", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "phase2s-index-read-test-"));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null when no index exists", async () => {
    const index = await readSessionIndex(tmpDir);
    expect(index).toBeNull();
  });

  it("returns null for corrupt index", async () => {
    const indexPath = join(tmpDir, ".phase2s", "sessions", "index.json");
    mkdirSync(join(tmpDir, ".phase2s", "sessions"), { recursive: true });
    writeFileSync(indexPath, "not json");
    const index = await readSessionIndex(tmpDir);
    expect(index).toBeNull();
  });
});

describe("listSessions() — index fast path", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "phase2s-list-test-"));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty array when no sessions exist", async () => {
    const sessions = await listSessions(tmpDir);
    expect(sessions).toEqual([]);
  });

  it("returns firstMessage from index without reading session files", async () => {
    const meta = makeMeta();
    await upsertSessionIndex(tmpDir, meta, "quick brown fox");
    // Create the session file so the path is valid, but index should be used
    const dir = join(tmpDir, ".phase2s", "sessions");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${meta.id}.json`),
      JSON.stringify({ schemaVersion: 2, meta, messages: [{ role: "user", content: "quick brown fox" }] }),
    );

    const sessions = await listSessions(tmpDir);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].firstMessage).toBe("quick brown fox");
    expect(sessions[0].meta.id).toBe(meta.id);
  });

  it("falls back to disk scan and rebuilds index when index is missing", async () => {
    const meta = makeMeta();
    const dir = join(tmpDir, ".phase2s", "sessions");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${meta.id}.json`),
      JSON.stringify({
        schemaVersion: 2,
        meta,
        messages: [{ role: "user", content: "fallback message" }],
      }),
    );

    // No index yet
    const sessions = await listSessions(tmpDir);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].firstMessage).toBe("fallback message");

    // Index should now be rebuilt on disk
    const index = await readSessionIndex(tmpDir);
    expect(index).not.toBeNull();
    expect(index!.sessions[meta.id]).toBeDefined();
  });

  it("sorts sessions newest-first by createdAt", async () => {
    const older = makeMeta({
      id: "00000000-0000-0000-0000-000000000001",
      createdAt: "2026-01-01T10:00:00.000Z",
      updatedAt: "2026-01-01T10:00:00.000Z",
    });
    const newer = makeMeta({
      id: "00000000-0000-0000-0000-000000000002",
      createdAt: "2026-04-01T10:00:00.000Z",
      updatedAt: "2026-04-01T10:00:00.000Z",
    });

    // Create the session files on disk — the stale-path filter (Item 2) removes
    // index entries whose files no longer exist, so files must be present.
    const dir = join(tmpDir, ".phase2s", "sessions");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${older.id}.json`),
      JSON.stringify({ schemaVersion: 2, meta: older, messages: [] }),
    );
    writeFileSync(
      join(dir, `${newer.id}.json`),
      JSON.stringify({ schemaVersion: 2, meta: newer, messages: [] }),
    );

    await upsertSessionIndex(tmpDir, older, "old");
    await upsertSessionIndex(tmpDir, newer, "new");

    const sessions = await listSessions(tmpDir);
    expect(sessions[0].meta.id).toBe(newer.id);
    expect(sessions[1].meta.id).toBe(older.id);
  });
});

describe("saveSession() — index upsert side-effect", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "phase2s-save-index-test-"));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("updates the session index after saving", async () => {
    const meta = makeMeta();
    const dir = join(tmpDir, ".phase2s", "sessions");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${meta.id}.json`);
    const conv = makeConv("hello from saveSession");

    await saveSession(tmpDir, path, conv, meta);

    // Poll for the fire-and-forget upsert to complete (more reliable than a fixed sleep)
    let index = null;
    for (let i = 0; i < 20; i++) {
      index = await readSessionIndex(tmpDir);
      if (index?.sessions[meta.id]) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(index).not.toBeNull();
    expect(index!.sessions[meta.id]).toBeDefined();
    expect(index!.sessions[meta.id].firstMessage).toBe("hello from saveSession");
  });
});

describe("cloneSession() — index upsert side-effect", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "phase2s-clone-index-test-"));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("adds the cloned session to the index", async () => {
    const sourceMeta = makeMeta({ id: "00000000-0000-0000-0000-000000000001" });
    const dir = join(tmpDir, ".phase2s", "sessions");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${sourceMeta.id}.json`),
      JSON.stringify({
        schemaVersion: 2,
        meta: sourceMeta,
        messages: [{ role: "user", content: "original message" }],
      }),
    );

    const result = await cloneSession(tmpDir, sourceMeta.id, "test-branch");

    // Poll for the fire-and-forget upsert to complete
    let index = null;
    for (let i = 0; i < 20; i++) {
      index = await readSessionIndex(tmpDir);
      if (index?.sessions[result.id]) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(index).not.toBeNull();
    expect(index!.sessions[result.id]).toBeDefined();
    expect(index!.sessions[result.id].parentId).toBe(sourceMeta.id);
    expect(index!.sessions[result.id].firstMessage).toBe("original message");
  });
});

// ---------------------------------------------------------------------------
// releasePosixLock() — PID guard (Item 1: ABA lock fix)
// ---------------------------------------------------------------------------

describe("releasePosixLock() — PID guard", () => {
  let tmpDir: string;
  let lockPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "phase2s-release-lock-test-"));
    mkdirSync(join(tmpDir, ".phase2s"), { recursive: true });
    lockPath = join(tmpDir, ".phase2s", ".state.lock");
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("does NOT unlink the lock when it belongs to a different PID (.state.lock)", () => {
    // Simulate a foreign process holding the lock (process.pid + 1 can never be our PID)
    writeFileSync(lockPath, String(process.pid + 1));
    releasePosixLock(lockPath);
    expect(existsSync(lockPath)).toBe(true);
  });

  it("DOES unlink the lock when it belongs to our PID (.state.lock)", () => {
    writeFileSync(lockPath, String(process.pid));
    releasePosixLock(lockPath);
    expect(existsSync(lockPath)).toBe(false);
  });

  it("does NOT unlink the lock when it belongs to a different PID (.index.lock)", () => {
    mkdirSync(join(tmpDir, ".phase2s", "sessions"), { recursive: true });
    const indexLockPath = join(tmpDir, ".phase2s", "sessions", ".index.lock");
    writeFileSync(indexLockPath, String(process.pid + 1));
    releasePosixLock(indexLockPath);
    expect(existsSync(indexLockPath)).toBe(true);
  });

  it("DOES unlink the lock when it belongs to our PID (.index.lock)", () => {
    mkdirSync(join(tmpDir, ".phase2s", "sessions"), { recursive: true });
    const indexLockPath = join(tmpDir, ".phase2s", "sessions", ".index.lock");
    writeFileSync(indexLockPath, String(process.pid));
    releasePosixLock(indexLockPath);
    expect(existsSync(indexLockPath)).toBe(false);
  });

  it("silently ignores a missing lock file (already gone)", () => {
    // File never created — should not throw
    expect(() => releasePosixLock(lockPath)).not.toThrow();
  });

  it("does not unlink a lock file with empty content (parseInt returns NaN)", () => {
    // Edge case: empty or corrupted lock file — parseInt("") returns NaN,
    // NaN !== process.pid, so the file should be treated as not-our-lock and NOT unlinked.
    // The stale-lock timeout will handle it on the next acquirePosixLock call.
    writeFileSync(lockPath, ""); // empty content
    releasePosixLock(lockPath);
    expect(existsSync(lockPath)).toBe(true); // file still present — we didn't own it
  });

  it("does not unlink a lock file with non-numeric content", () => {
    // Edge case: corrupted lock file with non-numeric PID
    writeFileSync(lockPath, "not-a-pid");
    releasePosixLock(lockPath);
    expect(existsSync(lockPath)).toBe(true); // file still present — we didn't own it
  });
});

// ---------------------------------------------------------------------------
// listSessions() — stale index path filter (Item 2)
// ---------------------------------------------------------------------------

describe("listSessions() — stale path filter", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "phase2s-stale-path-test-"));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("excludes index entries whose session file has been deleted from disk", async () => {
    const meta = makeMeta({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" });
    const dir = join(tmpDir, ".phase2s", "sessions");
    mkdirSync(dir, { recursive: true });

    // Write the session file and add it to the index
    const filePath = join(dir, `${meta.id}.json`);
    writeFileSync(
      filePath,
      JSON.stringify({ schemaVersion: 2, meta, messages: [] }),
      { encoding: "utf-8", mode: 0o600 },
    );
    await upsertSessionIndex(tmpDir, meta, "deleted session");

    // Index says the session exists — delete the file
    unlinkSync(filePath);
    expect(existsSync(filePath)).toBe(false);

    // listSessions should not return the deleted path
    const sessions = await listSessions(tmpDir);
    expect(sessions.find((s) => s.meta.id === meta.id)).toBeUndefined();
  });

  it("still returns live sessions when some are stale", async () => {
    const stale = makeMeta({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" });
    const live = makeMeta({
      id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      createdAt: "2026-04-09T10:00:00.000Z",
      updatedAt: "2026-04-09T10:00:00.000Z",
    });
    const dir = join(tmpDir, ".phase2s", "sessions");
    mkdirSync(dir, { recursive: true });

    // Write both session files
    const stalePath = join(dir, `${stale.id}.json`);
    writeFileSync(stalePath, JSON.stringify({ schemaVersion: 2, meta: stale, messages: [] }));
    const livePath = join(dir, `${live.id}.json`);
    writeFileSync(livePath, JSON.stringify({ schemaVersion: 2, meta: live, messages: [] }));

    // Add both to index
    await upsertSessionIndex(tmpDir, stale, "stale session");
    await upsertSessionIndex(tmpDir, live, "live session");

    // Delete the stale file
    unlinkSync(stalePath);

    const sessions = await listSessions(tmpDir);
    expect(sessions.find((s) => s.meta.id === stale.id)).toBeUndefined();
    expect(sessions.find((s) => s.meta.id === live.id)).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// rebuildSessionIndex() — lock-miss skip (Item 4)
// ---------------------------------------------------------------------------

describe("rebuildSessionIndex() — lock", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "phase2s-rebuild-lock-test-"));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null when .index.lock is held by a concurrent process", async () => {
    const dir = join(tmpDir, ".phase2s", "sessions");
    mkdirSync(dir, { recursive: true });
    // Pre-place a fresh (non-stale) lock to simulate a concurrent upsert
    const lockPath = join(dir, ".index.lock");
    writeFileSync(lockPath, "99999"); // fresh mtime — will not be cleaned as stale

    try {
      const result = await rebuildSessionIndex(tmpDir);
      expect(result).toBeNull();
      // Lock should still belong to the "other process" — not stolen or deleted
      expect(existsSync(lockPath)).toBe(true);
    } finally {
      try { unlinkSync(lockPath); } catch { /* already cleaned */ }
    }
  });

  it("acquires, rebuilds, and releases .index.lock on success", async () => {
    const dir = join(tmpDir, ".phase2s", "sessions");
    mkdirSync(dir, { recursive: true });

    // Write a valid session file for the rebuild to find
    const meta = makeMeta();
    writeFileSync(
      join(dir, `${meta.id}.json`),
      JSON.stringify({
        schemaVersion: 2,
        meta,
        messages: [{ role: "user", content: "rebuild test" }],
      }),
      { encoding: "utf-8", mode: 0o600 },
    );

    const result = await rebuildSessionIndex(tmpDir);

    // Rebuild should succeed and return the index
    expect(result).not.toBeNull();
    expect(result!.sessions[meta.id]).toBeDefined();
    expect(result!.sessions[meta.id].firstMessage).toBe("rebuild test");

    // Lock should be released after completion
    const lockPath = join(dir, ".index.lock");
    expect(existsSync(lockPath)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// listSessions() — slow-path null integration (lock contention during rebuild)
// ---------------------------------------------------------------------------

describe("listSessions() — slow-path null from rebuildSessionIndex", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "phase2s-listsessions-null-test-"));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns [] when index is absent AND rebuildSessionIndex returns null (lock held)", async () => {
    const dir = join(tmpDir, ".phase2s", "sessions");
    mkdirSync(dir, { recursive: true });

    // No index.json — will trigger slow path
    // Pre-place a fresh (non-stale) .index.lock to simulate concurrent upsert
    const lockPath = join(dir, ".index.lock");
    writeFileSync(lockPath, "99999"); // foreign PID, fresh mtime

    try {
      const result = await listSessions(tmpDir);
      // Slow path: rebuildSessionIndex returns null → listSessions returns []
      expect(result).toEqual([]);
    } finally {
      try { unlinkSync(lockPath); } catch { /* already cleaned */ }
    }
  });
});
