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
import type { Server } from "node:http";
import request from "supertest";
import { readConductLog } from "../../../src/cli/conduct-log.js";
import { startServer } from "../../../src/web/server.js";

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

// ---------------------------------------------------------------------------
// GET /api/runs/:id — Sprint 95: synthetic entry fallback (buildSyntheticEntry)
// ---------------------------------------------------------------------------

describe("GET /api/runs/:id — synthetic entry fallback", () => {
  let cwd: string;
  let server: Server;

  beforeEach(async () => {
    cwd = join(tmpdir(), `phase2s-runs95-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(join(cwd, ".phase2s", "runs"), { recursive: true });
    server = startServer(0, cwd);
  });

  afterEach(async () => {
    server.close();
    await rm(cwd, { recursive: true, force: true });
  });

  it("returns 200 with synthetic entry when run is in runs/ but not in conduct log", async () => {
    const specHash = "ab12cd34";
    const filename = `2026-05-11T10-00-00-${specHash}.jsonl`;
    await writeFile(
      join(cwd, ".phase2s", "runs", filename),
      JSON.stringify({ event: "goal_started", ts: new Date().toISOString(), specHash, subTaskCount: 3 }) + "\n",
    );

    const res = await request(server).get(`/api/runs/${specHash}`);
    expect(res.status).toBe(200);
    expect(res.body.entry.specHash).toBe(specHash);
    expect(res.body.entry.subtaskCount).toBe(3);
    expect(res.body).toHaveProperty("isActive");
    expect(res.body.isActive).toBe(true); // recent mtime + no terminal event
    expect(res.body.runLog).toBeInstanceOf(Array);
    expect(res.body.runLog.length).toBeGreaterThan(0);
  });

  it("extracts goal from spec file heading when specFile is set in goal_started", async () => {
    const specHash = "bb22ee44";
    const specsDir = join(cwd, ".phase2s", "specs");
    await mkdir(specsDir, { recursive: true });
    const specFile = join(specsDir, "my-spec.md");
    await writeFile(specFile, "# Implement live view\n\nDetails here.\n");

    const filename = `2026-05-11T10-00-00-${specHash}.jsonl`;
    await writeFile(
      join(cwd, ".phase2s", "runs", filename),
      JSON.stringify({ event: "goal_started", ts: new Date().toISOString(), specHash, specFile, subTaskCount: 2 }) + "\n",
    );

    const res = await request(server).get(`/api/runs/${specHash}`);
    expect(res.status).toBe(200);
    expect(res.body.entry.goal).toBe("Implement live view");
    expect(res.body.entry.subtaskCount).toBe(2);
    expect(res.body.entry.specPath).toBe(specFile);
  });

  it("falls back to 'Active run' when specFile is absent in goal_started", async () => {
    const specHash = "cc33ff55";
    const filename = `2026-05-11T10-00-00-${specHash}.jsonl`;
    await writeFile(
      join(cwd, ".phase2s", "runs", filename),
      JSON.stringify({ event: "goal_started", ts: new Date().toISOString(), specHash }) + "\n",
    );

    const res = await request(server).get(`/api/runs/${specHash}`);
    expect(res.status).toBe(200);
    expect(res.body.entry.goal).toBe("Active run");
  });

  it("returns isActive: false for a completed run when it is also in conduct log", async () => {
    const specHash = "dd44ab56";
    const filename = `2026-05-11T10-00-00-${specHash}.jsonl`;
    const runLogPath = join(cwd, ".phase2s", "runs", filename);

    await writeFile(
      join(cwd, ".phase2s", "conduct-log.jsonl"),
      JSON.stringify({
        ts: "2026-05-11T10:00:00.000Z",
        goal: "done run",
        specPath: null,
        specHash,
        subtaskCount: 1,
        roles: [],
        success: true,
        durationMs: 5000,
        runLogPath,
        rounds: 1,
      }) + "\n",
    );
    await writeFile(
      runLogPath,
      [
        JSON.stringify({ event: "goal_started", ts: new Date().toISOString() }),
        JSON.stringify({ event: "orchestrator_completed", ts: new Date().toISOString(), specHash, totalCompleted: 1, totalFailed: 0, totalSkipped: 0, suspectCount: 0, durationMs: 5000 }),
      ].join("\n") + "\n",
    );

    const res = await request(server).get(`/api/runs/${specHash}`);
    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(false);
  });
})
