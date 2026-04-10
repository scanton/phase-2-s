import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// We test the sessions listing + preview logic via session.ts functions directly,
// and test the plain-table output via conversations.ts.

import { listSessions, type SessionMeta } from "../../src/core/session.js";
import { runConversationsBrowser } from "../../src/cli/conversations.js";

function makeSessionFile(
  dir: string,
  id: string,
  meta: Partial<SessionMeta> = {},
  messages: object[] = [],
) {
  mkdirSync(dir, { recursive: true });
  const now = new Date().toISOString();
  const fullMeta: SessionMeta = {
    id,
    parentId: null,
    branchName: "main",
    createdAt: now,
    updatedAt: now,
    ...meta,
  };
  writeFileSync(
    join(dir, `${id}.json`),
    JSON.stringify({ schemaVersion: 2, meta: fullMeta, messages }, null, 2),
    { encoding: "utf-8", mode: 0o600 },
  );
}

describe("listSessions()", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "phase2s-list-test-"));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty array when sessions dir does not exist", async () => {
    const result = await listSessions(tmpDir);
    expect(result).toEqual([]);
  });

  it("returns empty array when sessions dir is empty", async () => {
    mkdirSync(join(tmpDir, ".phase2s", "sessions"), { recursive: true });
    expect(await listSessions(tmpDir)).toEqual([]);
  });

  it("lists v2 session files sorted newest-first", async () => {
    const sessDir = join(tmpDir, ".phase2s", "sessions");
    const id1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const id2 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    makeSessionFile(sessDir, id1, { createdAt: "2026-04-06T10:00:00Z" });
    makeSessionFile(sessDir, id2, { createdAt: "2026-04-08T10:00:00Z" });

    const results = await listSessions(tmpDir);
    expect(results.length).toBe(2);
    // Newest first
    expect(results[0].meta.id).toBe(id2);
    expect(results[1].meta.id).toBe(id1);
  });

  it("skips corrupted JSON files with a warning-safe no-op", async () => {
    const sessDir = join(tmpDir, ".phase2s", "sessions");
    mkdirSync(sessDir, { recursive: true });
    const goodId = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    makeSessionFile(sessDir, goodId);
    // Write a corrupted file with a valid UUID name
    writeFileSync(
      join(sessDir, "dddddddd-dddd-dddd-dddd-dddddddddddd.json"),
      "not valid json {{{",
    );
    const results = await listSessions(tmpDir);
    // Only the good file is returned
    expect(results.length).toBe(1);
    expect(results[0].meta.id).toBe(goodId);
  });

  it("ignores non-UUID files (migration.json, .tmp, .migrated)", async () => {
    const sessDir = join(tmpDir, ".phase2s", "sessions");
    mkdirSync(sessDir, { recursive: true });
    writeFileSync(join(sessDir, "migration.json"), JSON.stringify({ version: 1, entries: [] }));
    writeFileSync(join(sessDir, "2026-04-01.json.migrated"), "{}");
    writeFileSync(join(sessDir, "something.json.tmp"), "{}");
    const results = await listSessions(tmpDir);
    expect(results.length).toBe(0);
  });
});

describe("runConversationsBrowser() — no fzf / non-TTY fallback", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "phase2s-browser-test-"));
    // Ensure stdout.isTTY is false so fzf branch is never taken in tests
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("prints 'No sessions found' when sessions dir is empty", async () => {
    const consoleSpy = vi.spyOn(console, "log");
    await runConversationsBrowser(tmpDir);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("No sessions found"));
  });

  it("returns null (non-interactive mode — no selection)", async () => {
    const sessDir = join(tmpDir, ".phase2s", "sessions");
    makeSessionFile(sessDir, "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee");
    const result = await runConversationsBrowser(tmpDir);
    expect(result).toBeNull();
  });

  it("prints the plain table with session date and UUID", async () => {
    const sessDir = join(tmpDir, ".phase2s", "sessions");
    const id = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    makeSessionFile(sessDir, id, { createdAt: "2026-04-08T12:00:00Z", branchName: "feature/x" }, [
      { role: "user", content: "test message" },
    ]);
    const consoleSpy = vi.spyOn(console, "log");
    await runConversationsBrowser(tmpDir);
    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("2026-04-08");
    expect(output).toContain(id);
  });
});
