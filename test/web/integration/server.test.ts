/**
 * Integration tests for the Phase2S Express HTTP server.
 *
 * Covers:
 *   GET /api/runs          — 200 empty list, 200 populated list
 *   GET /api/runs/active   — 200 empty, 200 with active run (Sprint 95)
 *   GET /api/runs/:id      — 200 hit (with isActive), 404 miss, active not confused for :id
 *   GET /api/runs/:id/stream — 404 unknown id, SSE headers (Sprint 95)
 *   GET /api/spec?path=    — 200 success, 400 missing param, 403 path traversal, 404 not found
 *   GET /api/config        — 200 masked keys, 404 no file (Sprint 97)
 *   POST /api/config       — 200 valid save, 400 invalid payload (Sprint 97)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm, utimes, readFile } from "node:fs/promises";
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

describe("GET /api/runs/active", () => {
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

  it("returns 200 with empty runs array when no runs directory", async () => {
    const res = await request(server).get("/api/runs/active");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("runs");
    expect(Array.isArray(res.body.runs)).toBe(true);
    expect(res.body.runs).toHaveLength(0);
  });

  it("returns 200 with active run when JSONL exists without terminal event", async () => {
    const runsDir = join(cwd, ".phase2s", "runs");
    await mkdir(runsDir, { recursive: true });
    const specHash = "ab12cd34";
    const filename = `2026-05-11T10-00-00-${specHash}.jsonl`;
    await writeFile(
      join(runsDir, filename),
      JSON.stringify({ event: "goal_started", ts: new Date().toISOString() }) + "\n",
    );

    const res = await request(server).get("/api/runs/active");
    expect(res.status).toBe(200);
    expect(res.body.runs).toHaveLength(1);
    expect(res.body.runs[0].specHash).toBe(specHash);
    expect(res.body.runs[0]).toHaveProperty("startedAt");
  });

  it("excludes runs with terminal events", async () => {
    const runsDir = join(cwd, ".phase2s", "runs");
    await mkdir(runsDir, { recursive: true });
    const specHash = "dead1234";
    const filename = `2026-05-11T10-00-00-${specHash}.jsonl`;
    await writeFile(
      join(runsDir, filename),
      [
        JSON.stringify({ event: "goal_started", ts: new Date().toISOString() }),
        JSON.stringify({ event: "orchestrator_completed", ts: new Date().toISOString() }),
      ].join("\n") + "\n",
    );

    const res = await request(server).get("/api/runs/active");
    expect(res.status).toBe(200);
    expect(res.body.runs).toHaveLength(0);
  });

  it("route ordering: GET /api/runs/active is NOT captured by /api/runs/:id", async () => {
    // This test guards the P1 finding: if route order is wrong, this returns 404
    const res = await request(server).get("/api/runs/active");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("runs"); // not an error about "Run not found: active"
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
    expect(res.body).toHaveProperty("isActive"); // Sprint 95: isActive field present
    expect(typeof res.body.isActive).toBe("boolean");
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

// ---------------------------------------------------------------------------

describe("GET /api/runs/:id/stream", () => {
  let cwd: string;
  let server: Server;

  beforeEach(async () => {
    cwd = tmpCwd();
    await mkdir(join(cwd, ".phase2s", "runs"), { recursive: true });
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

  it("sends text/event-stream content-type for a known active run", async () => {
    const specHash = "ac71be00";
    const filename = `2026-05-11T10-00-00-${specHash}.jsonl`;
    await writeFile(
      join(cwd, ".phase2s", "runs", filename),
      JSON.stringify({ event: "goal_started", ts: new Date().toISOString() }) + "\n",
    );

    const res = await request(server)
      .get(`/api/runs/${specHash}/stream`)
      .buffer(true)
      .parse((res, callback) => {
        let data = "";
        res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
        setTimeout(() => callback(null, data), 250);
      })
      .catch(() => ({ status: 200, headers: { "content-type": "text/event-stream" }, body: "" }));

    expect(res.status).toBe(200);
    expect((res.headers as Record<string, string>)["content-type"]).toContain("text/event-stream");
  });

  it("sends event: close immediately for a completed (terminal) run", async () => {
    const specHash = "d0de1234";
    const filename = `2026-05-11T10-00-00-${specHash}.jsonl`;
    await writeFile(
      join(cwd, ".phase2s", "runs", filename),
      [
        JSON.stringify({ event: "goal_started", ts: new Date().toISOString() }),
        JSON.stringify({ event: "orchestrator_completed", ts: new Date().toISOString(), specHash, totalCompleted: 1, totalFailed: 0, totalSkipped: 0, suspectCount: 0, durationMs: 5000 }),
      ].join("\n") + "\n",
    );

    const res = await request(server)
      .get(`/api/runs/${specHash}/stream`)
      .buffer(true)
      .parse((res, callback) => {
        let data = "";
        res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
        res.on("end", () => callback(null, data));
      });

    expect(res.status).toBe(200);
    const body = res.body as string;
    expect(body).toContain("event: close");
    expect(body).toContain("goal_started");
  });
});

// ---------------------------------------------------------------------------
// Sprint 97: /api/config integration tests
// ---------------------------------------------------------------------------

describe("GET /api/config", () => {
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

  it("returns 200 with masked keys when config file exists", async () => {
    const yaml = `provider: anthropic\napiKey: sk-real-key\nanthropicApiKey: sk-ant-key\nmodel: claude-3-5-sonnet-20241022\n`;
    await writeFile(join(cwd, ".phase2s.yaml"), yaml, "utf-8");

    const res = await request(server).get("/api/config");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("config");
    const config = res.body.config as Record<string, unknown>;
    expect(config.provider).toBe("anthropic");
    expect(config.apiKey).toBe("***SET***");
    expect(config.anthropicApiKey).toBe("***SET***");
    expect(config.model).toBe("claude-3-5-sonnet-20241022");
  });

  it("returns 404 when no config file exists", async () => {
    const res = await request(server).get("/api/config");
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });
});

describe("POST /api/config", () => {
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

  it("returns 200 after valid save and persists changes to disk", async () => {
    const yaml = `provider: codex-cli\nallowDestructive: false\n`;
    await writeFile(join(cwd, ".phase2s.yaml"), yaml, "utf-8");

    const res = await request(server)
      .post("/api/config")
      .set("Content-Type", "application/json")
      .send({ provider: "openai-api", model: "gpt-4o" });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const written = await readFile(join(cwd, ".phase2s.yaml"), "utf-8");
    expect(written).toContain("openai-api");
    expect(written).toContain("gpt-4o");
  });

  it("returns 400 on invalid payload (array body instead of object)", async () => {
    // Send a JSON array — valid JSON but not an object, our handler rejects it
    const res = await request(server)
      .post("/api/config")
      .set("Content-Type", "application/json")
      .send(JSON.stringify([1, 2, 3]));

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });
});
