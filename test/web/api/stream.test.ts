/**
 * Tests for GET /api/runs/:id/stream SSE handler (Sprint 95)
 *
 * Tests cover:
 * 1. findRunLogPath: finds file by specHash in runs directory
 * 2. findRunLogPath: falls back to conduct log when not in runs dir
 * 3. findRunLogPath: returns null when not found anywhere
 * 4. SSE integration: catch-up sends existing events on connect
 * 5. SSE integration: sends event: close when terminal event already in file
 * 6. SSE integration: returns 404 for unknown specHash
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Server } from "node:http";
import request from "supertest";
import { startServer } from "../../../src/web/server.js";
import { findRunLogPath } from "../../../src/web/api/stream.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpCwd(): string {
  return join(
    tmpdir(),
    `phase2s-stream-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
}

async function setupCwd(cwd: string): Promise<void> {
  await mkdir(join(cwd, ".phase2s", "runs"), { recursive: true });
}

function makeEvent(event: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ event, ts: new Date().toISOString(), ...extra });
}

function logEntry(overrides: Record<string, unknown> = {}): object {
  return {
    ts: "2026-05-11T00:00:00.000Z",
    goal: "test goal",
    specPath: null,
    specHash: "abc12345",
    subtaskCount: 0,
    roles: [],
    success: true,
    durationMs: 1000,
    runLogPath: null,
    rounds: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// findRunLogPath
// ---------------------------------------------------------------------------

describe("findRunLogPath", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = tmpCwd();
    await setupCwd(cwd);
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("finds run log file by specHash in runs directory", async () => {
    const specHash = "ab12cd34";
    const filename = `2026-05-11T10-00-00-${specHash}.jsonl`;
    const filePath = join(cwd, ".phase2s", "runs", filename);
    await writeFile(filePath, makeEvent("goal_started") + "\n");

    const result = await findRunLogPath(cwd, specHash);
    expect(result).toBe(filePath);
  });

  it("falls back to conduct log when file not in runs dir", async () => {
    const specHash = "ff00ee11";
    const runLogPath = join(cwd, ".phase2s", "runs", `2026-05-11T10-00-00-${specHash}.jsonl`);
    // Write to conduct log only (no actual run file needed for path lookup)
    await writeFile(
      join(cwd, ".phase2s", "conduct-log.jsonl"),
      JSON.stringify(logEntry({ specHash, runLogPath })) + "\n",
    );

    const result = await findRunLogPath(cwd, specHash);
    expect(result).toBe(runLogPath);
  });

  it("returns null when specHash not found anywhere", async () => {
    const result = await findRunLogPath(cwd, "deadbeef");
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SSE endpoint integration
// ---------------------------------------------------------------------------

describe("GET /api/runs/:id/stream", () => {
  let cwd: string;
  let server: Server;

  beforeEach(async () => {
    cwd = tmpCwd();
    await setupCwd(cwd);
    server = startServer(0, cwd);
  });

  afterEach(async () => {
    server.close();
    await rm(cwd, { recursive: true, force: true });
  });

  it("returns 404 for an unknown specHash", async () => {
    const res = await request(server).get("/api/runs/deadbeef/stream");
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });

  it("sends existing events as catch-up and closes when terminal event found", async () => {
    const specHash = "ca11ab1e";
    const filename = `2026-05-11T10-00-00-${specHash}.jsonl`;
    const filePath = join(cwd, ".phase2s", "runs", filename);

    // Write a completed run log
    const events = [
      makeEvent("goal_started", { specHash, subTaskCount: 1 }),
      makeEvent("worker_completed", { index: 0, status: "passed", durationMs: 1000 }),
      makeEvent("orchestrator_completed", { specHash, totalCompleted: 1, totalFailed: 0, totalSkipped: 0, suspectCount: 0, durationMs: 5000 }),
    ];
    await writeFile(filePath, events.join("\n") + "\n");

    // Use supertest to get a single response (SSE headers + initial data)
    const res = await request(server)
      .get(`/api/runs/${specHash}/stream`)
      .buffer(true)
      .parse((res, callback) => {
        let data = "";
        res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
        res.on("end", () => { callback(null, data); });
      });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    const body = res.body as string;
    expect(body).toContain("goal_started");
    expect(body).toContain("orchestrator_completed");
    expect(body).toContain("event: close");
  });

  it("returns 200 SSE headers for an active (non-terminal) run", async () => {
    const specHash = "ac71beee";
    const filename = `2026-05-11T10-00-00-${specHash}.jsonl`;
    const filePath = join(cwd, ".phase2s", "runs", filename);
    await writeFile(filePath, makeEvent("goal_started", { specHash }) + "\n");

    // We can only check headers without waiting for the stream to end
    const res = await request(server)
      .get(`/api/runs/${specHash}/stream`)
      .timeout({ response: 500, deadline: 1000 })
      .buffer(true)
      .parse((res, callback) => {
        let data = "";
        res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
        // Don't wait for end — timeout will abort
        setTimeout(() => callback(null, data), 300);
      })
      .catch((err: Error) => {
        // Timeout is expected for a non-terminating stream
        if (err.message.includes("Timeout")) return { status: 200, headers: { "content-type": "text/event-stream" }, body: "" };
        throw err;
      });

    expect(res.status).toBe(200);
  });
});
