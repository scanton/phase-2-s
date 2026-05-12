/**
 * Tests for /api/runs handlers (Sprint 94)
 *
 * Tests cover:
 * 1. Returns [] when no log file exists
 * 2. Returns parsed entries sorted newest-first
 * 3. Skips malformed JSON lines
 * 4. Matches run detail by specHash
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readConductLog } from "../../../src/cli/conduct-log.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeTmpDir(): Promise<string> {
  const dir = join(tmpdir(), `phase2s-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

const BASE_ENTRY = {
  goal: "test goal",
  specPath: "/tmp/spec.md",
  specHash: "ab12cd34",
  subtaskCount: 3,
  roles: ["coder"],
  success: true,
  durationMs: 1234,
  runLogPath: "",
  rounds: 0,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("readConductLog", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await makeTmpDir();
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("returns [] when no log file exists", async () => {
    const entries = await readConductLog(cwd);
    expect(entries).toEqual([]);
  });

  it("returns parsed entries sorted newest-first", async () => {
    const phase2sDir = join(cwd, ".phase2s");
    await mkdir(phase2sDir, { recursive: true });

    const entry1 = { ...BASE_ENTRY, ts: "2024-01-01T10:00:00.000Z", goal: "first" };
    const entry2 = { ...BASE_ENTRY, ts: "2024-01-02T10:00:00.000Z", goal: "second" };
    const logPath = join(phase2sDir, "conduct-log.jsonl");
    await writeFile(logPath, [entry1, entry2].map((e) => JSON.stringify(e)).join("\n") + "\n");

    const entries = await readConductLog(cwd);
    expect(entries).toHaveLength(2);
    // newest-first
    expect(entries[0].goal).toBe("second");
    expect(entries[1].goal).toBe("first");
  });

  it("skips malformed JSON lines", async () => {
    const phase2sDir = join(cwd, ".phase2s");
    await mkdir(phase2sDir, { recursive: true });

    const entry = { ...BASE_ENTRY, ts: "2024-01-01T10:00:00.000Z", goal: "valid" };
    const logPath = join(phase2sDir, "conduct-log.jsonl");
    await writeFile(
      logPath,
      [JSON.stringify(entry), "{bad json", "", JSON.stringify(entry)].join("\n") + "\n"
    );

    const entries = await readConductLog(cwd);
    // 2 valid entries, 1 malformed skipped
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.goal === "valid")).toBe(true);
  });

  it("matches run detail by specHash", async () => {
    const phase2sDir = join(cwd, ".phase2s");
    await mkdir(phase2sDir, { recursive: true });

    const target = { ...BASE_ENTRY, ts: "2024-01-01T10:00:00.000Z", specHash: "deadbeef" };
    const other = { ...BASE_ENTRY, ts: "2024-01-02T10:00:00.000Z", specHash: "cafebabe" };
    const logPath = join(phase2sDir, "conduct-log.jsonl");
    await writeFile(logPath, [target, other].map((e) => JSON.stringify(e)).join("\n") + "\n");

    const entries = await readConductLog(cwd);
    const found = entries.find((e) => e.specHash === "deadbeef");
    expect(found).toBeDefined();
    expect(found!.specHash).toBe("deadbeef");
  });
});

// assertInProject tests are in test/web/api/spec.test.ts
// (realpath-based guard requires real filesystem fixtures)
