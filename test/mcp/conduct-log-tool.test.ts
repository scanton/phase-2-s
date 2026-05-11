import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { rm } from "node:fs/promises";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleRequest } from "../../src/mcp/handler.js";
import type { JSONRPCRequest } from "../../src/mcp/handler.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function callTool(
  cwd: string,
  args: Record<string, unknown>,
): Promise<{ result?: { content: Array<{ type: string; text: string }> }; error?: { code: number; message: string } }> {
  const req: JSONRPCRequest = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "phase2s__conduct_log", arguments: args },
  };
  return handleRequest(req, [], cwd) as Promise<{ result?: { content: Array<{ type: string; text: string }> }; error?: { code: number; message: string } }>;
}

function writeConductLog(cwd: string, entries: object[]): void {
  const dir = join(cwd, ".phase2s");
  mkdirSync(dir, { recursive: true });
  const lines = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  writeFileSync(join(dir, "conduct-log.jsonl"), lines, "utf8");
}

const SAMPLE_ENTRY = {
  ts: "2024-01-15T10:00:00.000Z",
  goal: "add user authentication",
  specPath: "/tmp/spec.md",
  specHash: "abc12345",
  subtaskCount: 4,
  roles: ["backend", "security"],
  success: true,
  durationMs: 30000,
  runLogPath: "/tmp/run.jsonl",
  rounds: 0,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("phase2s__conduct_log MCP tool", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "phase2s-clt-test-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ---- action: list ----

  it("list: returns parsed entries as JSON text", async () => {
    writeConductLog(tmpDir, [SAMPLE_ENTRY]);
    const res = await callTool(tmpDir, { action: "list", cwd: tmpDir });
    expect(res.error).toBeUndefined();
    const parsed = JSON.parse(res.result!.content[0].text);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].goal).toBe("add user authentication");
  });

  it("list: returns empty array when no log exists", async () => {
    const res = await callTool(tmpDir, { action: "list", cwd: tmpDir });
    expect(res.error).toBeUndefined();
    const parsed = JSON.parse(res.result!.content[0].text);
    expect(parsed).toEqual([]);
  });

  it("list: respects limit parameter", async () => {
    writeConductLog(tmpDir, [
      { ...SAMPLE_ENTRY, ts: "2024-01-01T00:00:00Z", goal: "goal one" },
      { ...SAMPLE_ENTRY, ts: "2024-01-02T00:00:00Z", goal: "goal two" },
      { ...SAMPLE_ENTRY, ts: "2024-01-03T00:00:00Z", goal: "goal three" },
    ]);
    const res = await callTool(tmpDir, { action: "list", limit: 2, cwd: tmpDir });
    const parsed = JSON.parse(res.result!.content[0].text);
    expect(parsed).toHaveLength(2);
  });

  it("list: defaults to limit 10 when not specified", async () => {
    const entries = Array.from({ length: 15 }, (_, i) => ({
      ...SAMPLE_ENTRY,
      ts: `2024-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
      goal: `goal ${i}`,
    }));
    writeConductLog(tmpDir, entries);
    const res = await callTool(tmpDir, { action: "list", cwd: tmpDir });
    const parsed = JSON.parse(res.result!.content[0].text);
    expect(parsed).toHaveLength(10);
  });

  // ---- action: stats ----

  it("stats: returns aggregated stats as JSON text", async () => {
    writeConductLog(tmpDir, [
      { ...SAMPLE_ENTRY, success: true },
      { ...SAMPLE_ENTRY, success: true },
      { ...SAMPLE_ENTRY, success: false },
    ]);
    const res = await callTool(tmpDir, { action: "stats", cwd: tmpDir });
    expect(res.error).toBeUndefined();
    const stats = JSON.parse(res.result!.content[0].text);
    expect(stats.totalRuns).toBe(3);
    expect(stats.successCount).toBe(2);
    expect(typeof stats.successRate).toBe("number");
  });

  it("stats: returns zero stats when no log exists", async () => {
    const res = await callTool(tmpDir, { action: "stats", cwd: tmpDir });
    expect(res.error).toBeUndefined();
    const stats = JSON.parse(res.result!.content[0].text);
    expect(stats.totalRuns).toBe(0);
    expect(stats.successRate).toBe(0);
  });

  it("stats: excludes dry-run entries from totalRuns", async () => {
    writeConductLog(tmpDir, [
      { ...SAMPLE_ENTRY, success: true },
      { ...SAMPLE_ENTRY, success: false, dryRun: true },
    ]);
    const res = await callTool(tmpDir, { action: "stats", cwd: tmpDir });
    const stats = JSON.parse(res.result!.content[0].text);
    expect(stats.totalRuns).toBe(1);
    expect(stats.dryRunCount).toBe(1);
  });

  // ---- action: search (no Ollama — fallback to recency) ----

  it("search: requires query argument", async () => {
    const res = await callTool(tmpDir, { action: "search", cwd: tmpDir });
    expect(res.error).toBeDefined();
    expect(res.error!.code).toBe(-32602);
    expect(res.error!.message).toMatch(/query is required/i);
  });

  it("search: falls back to recency list when Ollama not configured", async () => {
    writeConductLog(tmpDir, [SAMPLE_ENTRY]);
    const res = await callTool(tmpDir, { action: "search", query: "auth", cwd: tmpDir });
    expect(res.error).toBeUndefined();
    const text = res.result!.content[0].text;
    // Should contain fallback note
    expect(text).toMatch(/ollamaBaseUrl.*not configured|Ollama.*unavailable/i);
  });

  // ---- defaults cwd to process.cwd() when not provided ----

  it("list: cwd defaults to handler cwd when not in args", async () => {
    writeConductLog(tmpDir, [SAMPLE_ENTRY]);
    // Pass cwd via the handler's cwd arg, not the tool args
    const req: JSONRPCRequest = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "phase2s__conduct_log", arguments: { action: "list" } },
    };
    const res = await handleRequest(req, [], tmpDir) as { result?: { content: Array<{ type: string; text: string }> }; error?: { code: number; message: string } };
    expect(res.error).toBeUndefined();
    const parsed = JSON.parse(res.result!.content[0].text);
    expect(Array.isArray(parsed)).toBe(true);
  });
});
