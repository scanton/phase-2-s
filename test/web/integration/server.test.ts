/**
 * Integration tests for the Sprint 94 Express HTTP server.
 *
 * Covers:
 *   GET /api/runs          — 200 empty list, 200 populated list
 *   GET /api/runs/:id      — 200 hit, 404 miss
 *   GET /api/spec?path=    — 200 success, 400 missing param, 403 path traversal, 404 not found
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Server } from "node:http";
import request from "supertest";
import { startServer } from "../../../src/web/server.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpCwd(): string {
  return join(tmpdir(), `phase2s-server-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

async function setupCwd(cwd: string): Promise<void> {
  await mkdir(join(cwd, ".phase2s"), { recursive: true });
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
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/runs", () => {
  let cwd: string;
  let server: Server;

  beforeEach(async () => {
    cwd = tmpCwd();
    await setupCwd(cwd);
    server = startServer(0, cwd); // port 0 → OS picks a free port
  });

  afterEach(async () => {
    server.close();
    await rm(cwd, { recursive: true, force: true });
  });

  it("returns 200 with [] when conduct-log.jsonl is absent", async () => {
    const res = await request(server).get("/api/runs");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns 200 with parsed entries sorted newest first", async () => {
    const entries = [
      logEntry({ ts: "2026-05-10T00:00:00.000Z", specHash: "aaa11111", goal: "older" }),
      logEntry({ ts: "2026-05-11T00:00:00.000Z", specHash: "bbb22222", goal: "newer" }),
    ];
    await writeFile(
      join(cwd, ".phase2s", "conduct-log.jsonl"),
      entries.map((e) => JSON.stringify(e)).join("\n") + "\n",
    );
    const res = await request(server).get("/api/runs");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].specHash).toBe("bbb22222"); // newest first
    expect(res.body[1].specHash).toBe("aaa11111");
  });
});

// ---------------------------------------------------------------------------

describe("GET /api/runs/:id", () => {
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

  it("returns 200 with run detail for a known specHash", async () => {
    const entry = logEntry({ specHash: "abc12345" });
    await writeFile(
      join(cwd, ".phase2s", "conduct-log.jsonl"),
      JSON.stringify(entry) + "\n",
    );
    const res = await request(server).get("/api/runs/abc12345");
    expect(res.status).toBe(200);
    expect(res.body.entry.specHash).toBe("abc12345");
    expect(res.body).toHaveProperty("spec");
    expect(res.body).toHaveProperty("runLog");
  });

  it("returns 404 for an unknown specHash", async () => {
    // empty log
    await writeFile(join(cwd, ".phase2s", "conduct-log.jsonl"), "");
    const res = await request(server).get("/api/runs/deadbeef");
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });
});

// ---------------------------------------------------------------------------

describe("GET /api/spec", () => {
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

  it("returns 400 when ?path is missing", async () => {
    const res = await request(server).get("/api/spec");
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 403 when path traversal is attempted", async () => {
    const evilPath = encodeURIComponent("/etc/passwd");
    const res = await request(server).get(`/api/spec?path=${evilPath}`);
    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 404 when the spec file does not exist", async () => {
    const missingPath = encodeURIComponent(join(cwd, ".phase2s", "specs", "missing.md"));
    const res = await request(server).get(`/api/spec?path=${missingPath}`);
    expect(res.status).toBe(404);
  });

  it("returns 200 with markdown content for a valid spec file", async () => {
    const specDir = join(cwd, ".phase2s", "specs");
    await mkdir(specDir, { recursive: true });
    const specPath = join(specDir, "my-spec.md");
    await writeFile(specPath, "# My Spec\n\nContent here.");
    const res = await request(server).get(`/api/spec?path=${encodeURIComponent(specPath)}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain("# My Spec");
  });
});
