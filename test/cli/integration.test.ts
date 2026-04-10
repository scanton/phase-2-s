/**
 * Integration tests for session persistence and --resume regression.
 *
 * These tests verify that the session infrastructure works end-to-end:
 * - findLatestSession() reads from state.json (not date-regex)
 * - --resume works correctly after migration renames sessions to UUIDs
 * - state.json missing returns null gracefully
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readReplState, writeReplState, migrateAll } from "../../src/core/session.js";
import { Conversation } from "../../src/core/conversation.js";

function sessionsDir(cwd: string) {
  return join(cwd, ".phase2s", "sessions");
}

function writeLegacySession(cwd: string, filename: string, messages: object[]) {
  const dir = sessionsDir(cwd);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, filename), JSON.stringify(messages, null, 2), "utf-8");
}

// Simulate what findLatestSession() does after the update:
// reads state.json to get currentSessionId, returns path or null.
async function simulateFindLatestSession(cwd: string): Promise<string | null> {
  const state = readReplState(cwd);
  if (!state?.currentSessionId) return null;
  const path = join(sessionsDir(cwd), `${state.currentSessionId}.json`);
  try {
    const { access, constants } = await import("node:fs/promises");
    await access(path, constants.R_OK);
    return path;
  } catch {
    return null;
  }
}

describe("findLatestSession() — reads from state.json (regression)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "phase2s-integration-test-"));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null when state.json does not exist", async () => {
    const result = await simulateFindLatestSession(tmpDir);
    expect(result).toBeNull();
  });

  it("returns path when state.json has a valid currentSessionId", async () => {
    const id = "aabbccdd-0000-0000-0000-000000000000";
    const dir = sessionsDir(tmpDir);
    mkdirSync(dir, { recursive: true });
    const sessionPath = join(dir, `${id}.json`);
    writeFileSync(
      sessionPath,
      JSON.stringify({
        schemaVersion: 2,
        meta: { id, parentId: null, branchName: "main", createdAt: "", updatedAt: "" },
        messages: [],
      }),
    );
    await writeReplState(tmpDir, { currentSessionId: id });

    const result = await simulateFindLatestSession(tmpDir);
    expect(result).toBe(sessionPath);
  });

  it("returns null when state.json points to a deleted file", async () => {
    await writeReplState(tmpDir, { currentSessionId: "nonexistent-uuid" });
    const result = await simulateFindLatestSession(tmpDir);
    expect(result).toBeNull();
  });

  it("does NOT match date-named YYYY-MM-DD.json files (old behavior retired)", async () => {
    // Write a legacy date-named file (should not be returned by new findLatestSession)
    writeLegacySession(tmpDir, "2026-04-08.json", [{ role: "user", content: "legacy" }]);
    // No state.json written
    const result = await simulateFindLatestSession(tmpDir);
    expect(result).toBeNull();
  });
});

describe("--resume regression: works after migration renames sessions", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "phase2s-resume-regression-test-"));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads migrated session via state.json after migrateAll()", async () => {
    // Set up a legacy session file
    writeLegacySession(tmpDir, "2026-04-08.json", [
      { role: "user", content: "hello from legacy" },
      { role: "assistant", content: "hi" },
    ]);

    // Run migration (simulating first launch after upgrade)
    await migrateAll(tmpDir);

    // migrateAll() should have written state.json with the new UUID
    const state = readReplState(tmpDir);
    expect(state?.currentSessionId).toBeTruthy();

    // The UUID-named session file should exist and be loadable
    const sessionPath = join(sessionsDir(tmpDir), `${state!.currentSessionId}.json`);
    expect(existsSync(sessionPath)).toBe(true);

    const conv = await Conversation.load(sessionPath);
    expect(conv.length).toBe(2);
    expect(conv.getMessages()[0].content).toBe("hello from legacy");
  });

  it("v1 session file is loadable by Conversation.load() (v1 compat regression)", async () => {
    const dir = sessionsDir(tmpDir);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "legacy.json");
    writeFileSync(
      path,
      JSON.stringify([
        { role: "user", content: "legacy v1 content" },
        { role: "assistant", content: "response" },
      ]),
    );
    // Must not throw — v1 format is still supported
    const conv = await Conversation.load(path);
    expect(conv.length).toBe(2);
    expect(conv.getMessages()[0].role).toBe("user");
  });

  it("v2 session file is loadable by Conversation.load() (new format regression)", async () => {
    const dir = sessionsDir(tmpDir);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "v2.json");
    const id = "v2id0000-0000-0000-0000-000000000000";
    writeFileSync(
      path,
      JSON.stringify({
        schemaVersion: 2,
        meta: { id, parentId: null, branchName: "main", createdAt: "", updatedAt: "" },
        messages: [
          { role: "user", content: "v2 user content" },
          { role: "assistant", content: "v2 response" },
        ],
      }),
    );
    const conv = await Conversation.load(path);
    expect(conv.length).toBe(2);
    expect(conv.getMessages()[0].content).toBe("v2 user content");
  });
});
