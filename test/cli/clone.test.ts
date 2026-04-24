import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cloneSession, readReplState, type SessionMeta } from "../../src/core/session.js";

function sessionsDir(cwd: string) {
  return join(cwd, ".phase2s", "sessions");
}

function writeV2Session(cwd: string, id: string, messages: object[] = [], parentId: string | null = null) {
  const dir = sessionsDir(cwd);
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

function readSession(path: string) {
  return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
}

describe(":clone command — cloneSession()", () => {
  let tmpDir: string;
  const SOURCE_ID = "source00-0000-0000-0000-000000000000";

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "phase2s-clone-cmd-test-"));
    writeV2Session(tmpDir, SOURCE_ID, [
      { role: "user", content: "original question" },
      { role: "assistant", content: "original answer" },
    ]);
  });

  afterEach(async () => {
    // upsertSessionIndex is fire-and-forget in cloneSession — it writes lock
    // files and index.json.tmp.<pid> inside tmpDir after cloneSession resolves.
    // A brief settle lets those I/O ops finish before rm tears down the tree,
    // preventing the ENOTEMPTY race that caused intermittent CI failures.
    await new Promise<void>((r) => setTimeout(r, 50));
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("creates a new session file (UUID-named)", async () => {
    const result = await cloneSession(tmpDir, SOURCE_ID);
    expect(existsSync(result.path)).toBe(true);
    expect(result.id).not.toBe(SOURCE_ID);
  });

  it("new session has schemaVersion: 2", async () => {
    const result = await cloneSession(tmpDir, SOURCE_ID);
    const parsed = readSession(result.path);
    expect(parsed.schemaVersion).toBe(2);
  });

  it("new session inherits messages from source", async () => {
    const result = await cloneSession(tmpDir, SOURCE_ID);
    const parsed = readSession(result.path);
    expect((parsed.messages as object[]).length).toBe(2);
    expect((parsed.messages as Array<{ role: string; content: string }>)[0].content).toBe("original question");
    expect(result.messageCount).toBe(2);
  });

  it("parentId is set to source session id", async () => {
    const result = await cloneSession(tmpDir, SOURCE_ID);
    const parsed = readSession(result.path);
    expect((parsed.meta as SessionMeta).parentId).toBe(SOURCE_ID);
  });

  it("uses provided branchName in new session", async () => {
    const result = await cloneSession(tmpDir, SOURCE_ID, "feature/retry-experiment");
    const parsed = readSession(result.path);
    expect((parsed.meta as SessionMeta).branchName).toBe("feature/retry-experiment");
  });

  it("defaults branchName to fork-YYYY-MM-DD format", async () => {
    const result = await cloneSession(tmpDir, SOURCE_ID);
    const parsed = readSession(result.path);
    const bn = (parsed.meta as SessionMeta).branchName;
    expect(bn).toMatch(/^fork-\d{4}-\d{2}-\d{2}$/);
  });

  it("throws a 'not found' error for invalid session id", async () => {
    await expect(
      cloneSession(tmpDir, "does-not-exist"),
    ).rejects.toThrow(/not found/i);
  });

  it("throws for empty string session id", async () => {
    await expect(cloneSession(tmpDir, "")).rejects.toThrow();
  });

  it("clone-of-clone has correct grandchild parentId", async () => {
    const child = await cloneSession(tmpDir, SOURCE_ID, "child");
    const grandchild = await cloneSession(tmpDir, child.id, "grandchild");

    const childParsed = readSession(child.path);
    const grandchildParsed = readSession(grandchild.path);

    expect((childParsed.meta as SessionMeta).parentId).toBe(SOURCE_ID);
    expect((grandchildParsed.meta as SessionMeta).parentId).toBe(child.id);
  });

  it("return value includes createdAt and updatedAt matching on-disk meta", async () => {
    const result = await cloneSession(tmpDir, SOURCE_ID, "ts-check");
    const parsed = readSession(result.path);
    const onDiskMeta = parsed.meta as SessionMeta;
    // The return timestamps must match what was written to disk exactly.
    // If the caller re-called new Date() they would drift from the on-disk value.
    expect(result.createdAt).toBe(onDiskMeta.createdAt);
    expect(result.updatedAt).toBe(onDiskMeta.updatedAt);
  });

  it("return value createdAt is a valid ISO 8601 timestamp", async () => {
    const result = await cloneSession(tmpDir, SOURCE_ID);
    expect(() => new Date(result.createdAt).toISOString()).not.toThrow();
    expect(result.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});
