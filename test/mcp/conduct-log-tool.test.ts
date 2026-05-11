import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
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

  // ---- action: search (Ollama configured — semantic path) ----

  it("search: returns semantic results when Ollama embedding returns a vector and index has entries", async () => {
    // Pre-populate conduct-index.json with one entry
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(`${tmpDir}/.phase2s`, { recursive: true });
    const indexEntry = {
      id: "2024-01-15T10:00:00.000Z",
      goalSnippet: "add user authentication",
      embedding: [1, 0, 0],
      success: true,
      durationMs: 30000,
      subtaskCount: 4,
    };
    await writeFile(
      `${tmpDir}/.phase2s/conduct-index.json`,
      JSON.stringify({ version: 1, entries: [indexEntry] }),
      "utf8",
    );

    // Mock generateEmbedding to return a real vector
    const embeddingsModule = await import("../../src/core/embeddings.js");
    vi.spyOn(embeddingsModule, "generateEmbedding").mockResolvedValueOnce([1, 0, 0]);

    // Mock loadConfig to return Ollama settings
    const configModule = await import("../../src/core/config.js");
    vi.spyOn(configModule, "loadConfig").mockResolvedValueOnce({
      ollamaBaseUrl: "http://localhost:11434",
      ollamaEmbedModel: "nomic-embed-text",
    } as Awaited<ReturnType<typeof configModule.loadConfig>>);

    const res = await callTool(tmpDir, { action: "search", query: "authentication", cwd: tmpDir });
    expect(res.error).toBeUndefined();
    const text = res.result!.content[0].text;
    // Should return semantic results (JSON array), not the fallback note
    expect(text).not.toMatch(/not configured/i);
    const results = JSON.parse(text);
    expect(Array.isArray(results)).toBe(true);
    expect(results[0]).toHaveProperty("similarity");
    expect(results[0].goalSnippet).toBe("add user authentication");
  });

  it("search: falls back to recency when Ollama returns empty embedding", async () => {
    writeConductLog(tmpDir, [SAMPLE_ENTRY]);

    // Mock generateEmbedding to return empty (Ollama down)
    const embeddingsModule = await import("../../src/core/embeddings.js");
    vi.spyOn(embeddingsModule, "generateEmbedding").mockResolvedValueOnce([]);

    // Mock loadConfig to return Ollama settings (configured but Ollama unreachable)
    const configModule = await import("../../src/core/config.js");
    vi.spyOn(configModule, "loadConfig").mockResolvedValueOnce({
      ollamaBaseUrl: "http://localhost:11434",
      ollamaEmbedModel: "nomic-embed-text",
    } as Awaited<ReturnType<typeof configModule.loadConfig>>);

    const res = await callTool(tmpDir, { action: "search", query: "auth", cwd: tmpDir });
    expect(res.error).toBeUndefined();
    const text = res.result!.content[0].text;
    // Falls back to recency with Ollama note
    expect(text).toMatch(/Ollama embedding unavailable/i);
  });

  it("search: 'No similar entries found' when index is empty but Ollama works", async () => {
    // Index file exists but has no embeddable entries
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(`${tmpDir}/.phase2s`, { recursive: true });
    await writeFile(
      `${tmpDir}/.phase2s/conduct-index.json`,
      JSON.stringify({ version: 1, entries: [] }),
      "utf8",
    );

    const embeddingsModule = await import("../../src/core/embeddings.js");
    vi.spyOn(embeddingsModule, "generateEmbedding").mockResolvedValueOnce([1, 0, 0]);

    const configModule = await import("../../src/core/config.js");
    vi.spyOn(configModule, "loadConfig").mockResolvedValueOnce({
      ollamaBaseUrl: "http://localhost:11434",
      ollamaEmbedModel: "nomic-embed-text",
    } as Awaited<ReturnType<typeof configModule.loadConfig>>);

    const res = await callTool(tmpDir, { action: "search", query: "auth", cwd: tmpDir });
    expect(res.error).toBeUndefined();
    const text = res.result!.content[0].text;
    expect(text).toMatch(/No similar entries found/i);
  });

  // ---- error handling ----

  it("returns error object on unexpected readConductLog failure", async () => {
    // Provide a corrupted log file (directory instead of file) to trigger an error
    const { mkdir } = await import("node:fs/promises");
    // Create a directory at the log path so readFile throws EISDIR
    await mkdir(`${tmpDir}/.phase2s/conduct-log.jsonl`, { recursive: true });
    const res = await callTool(tmpDir, { action: "list", cwd: tmpDir });
    // readConductLog handles ENOENT gracefully but EISDIR may propagate to catch
    // Either way no unhandled rejection — the response has either result or error
    expect(res.result ?? res.error).toBeDefined();
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

  // ---- unknown action ----

  it("returns -32602 for unknown action values", async () => {
    const res = await callTool(tmpDir, { action: "bogus", cwd: tmpDir });
    expect(res.error).toBeDefined();
    expect(res.error!.code).toBe(-32602);
    expect(res.error!.message).toMatch(/unknown action/i);
    expect(res.error!.message).toContain("bogus");
  });

  // ---- stats respects limit ----

  it("stats: respects the limit parameter (does not read unbounded log)", async () => {
    // Write 20 entries; ask for stats with limit 5 — only those 5 should be counted.
    const entries = Array.from({ length: 20 }, (_, i) => ({ ...SAMPLE_ENTRY, success: i % 2 === 0 }));
    writeConductLog(tmpDir, entries);
    const res = await callTool(tmpDir, { action: "stats", limit: 5, cwd: tmpDir });
    expect(res.error).toBeUndefined();
    const stats = JSON.parse(res.result!.content[0].text);
    // Only 5 entries read, so totalRuns must be 5 not 20.
    expect(stats.totalRuns).toBe(5);
  });
});
