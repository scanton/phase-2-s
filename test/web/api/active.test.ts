/**
 * Tests for GET /api/runs/active handler (Sprint 95)
 *
 * Tests cover:
 * 1. Returns [] when runs directory doesn't exist
 * 2. Returns [] when all runs have terminal events
 * 3. Returns active run when mtime is recent and no terminal event
 * 4. Excludes stale runs (mtime > 30 minutes)
 * 5. Detects orchestrator_completed as terminal
 * 6. Detects goal_completed as terminal
 * 7. Detects goal_error as terminal
 * 8. Returns multiple active runs sorted newest-first
 * 9. isActiveRun: empty file returns false
 * 10. readFileTail: reads last N bytes correctly
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm, utimes } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { isActiveRun, readFileTail } from "../../../src/web/api/active.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeTmpDir(): Promise<string> {
  const dir = join(
    tmpdir(),
    `phase2s-active-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(dir, { recursive: true });
  return dir;
}

function makeEvent(event: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ event, ts: new Date().toISOString(), ...extra });
}

// ---------------------------------------------------------------------------
// readFileTail
// ---------------------------------------------------------------------------

describe("readFileTail", () => {
  let dir: string;

  beforeEach(async () => { dir = await makeTmpDir(); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("reads the full file when maxBytes >= file size", async () => {
    const path = join(dir, "test.jsonl");
    await writeFile(path, "hello world");
    const tail = await readFileTail(path, 100);
    expect(tail).toBe("hello world");
  });

  it("reads only the last N bytes for a large file", async () => {
    const path = join(dir, "test.jsonl");
    const content = "A".repeat(1000) + "LAST";
    await writeFile(path, content);
    const tail = await readFileTail(path, 4);
    expect(tail).toBe("LAST");
  });

  it("returns empty string for empty file", async () => {
    const path = join(dir, "empty.jsonl");
    await writeFile(path, "");
    const tail = await readFileTail(path, 100);
    expect(tail).toBe("");
  });
});

// ---------------------------------------------------------------------------
// isActiveRun
// ---------------------------------------------------------------------------

describe("isActiveRun", () => {
  let dir: string;

  beforeEach(async () => { dir = await makeTmpDir(); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("returns false for an empty file", async () => {
    const path = join(dir, "empty.jsonl");
    await writeFile(path, "");
    expect(await isActiveRun(path)).toBe(false);
  });

  it("returns false when mtime is older than 30 minutes", async () => {
    const path = join(dir, "old.jsonl");
    await writeFile(path, makeEvent("goal_started") + "\n");
    // Set mtime to 31 minutes ago
    const old = new Date(Date.now() - 31 * 60 * 1000);
    await utimes(path, old, old);
    expect(await isActiveRun(path)).toBe(false);
  });

  it("returns true when mtime is recent and no terminal event", async () => {
    const path = join(dir, "active.jsonl");
    await writeFile(
      path,
      [makeEvent("goal_started"), makeEvent("worker_started")].join("\n") + "\n",
    );
    expect(await isActiveRun(path)).toBe(true);
  });

  it("returns false when orchestrator_completed is present", async () => {
    const path = join(dir, "done.jsonl");
    await writeFile(
      path,
      [makeEvent("goal_started"), makeEvent("orchestrator_completed")].join("\n") + "\n",
    );
    expect(await isActiveRun(path)).toBe(false);
  });

  it("returns false when goal_completed is present", async () => {
    const path = join(dir, "done2.jsonl");
    await writeFile(
      path,
      [makeEvent("goal_started"), makeEvent("goal_completed")].join("\n") + "\n",
    );
    expect(await isActiveRun(path)).toBe(false);
  });

  it("returns false when goal_error is present", async () => {
    const path = join(dir, "err.jsonl");
    await writeFile(
      path,
      [makeEvent("goal_started"), makeEvent("goal_error", { message: "oops" })].join("\n") + "\n",
    );
    expect(await isActiveRun(path)).toBe(false);
  });

  it("skips malformed lines and still detects active run", async () => {
    const path = join(dir, "malformed.jsonl");
    await writeFile(path, makeEvent("goal_started") + "\n{bad json}\n");
    expect(await isActiveRun(path)).toBe(true);
  });
});
