import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Module-level mock fn references
// ---------------------------------------------------------------------------

const generateEmbeddingMock = vi.fn() as Mock;
const readCodeIndexMock = vi.fn() as Mock;
const checkIndexStalenessMock = vi.fn() as Mock;

function cosineSim(a: number[], b: number[]): number {
  if (a.length === 0 || b.length !== a.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; normA += a[i] * a[i]; normB += b[i] * b[i];
  }
  const d = Math.sqrt(normA) * Math.sqrt(normB);
  return d === 0 ? 0 : dot / d;
}

vi.mock("../../src/core/embeddings.js", () => ({
  generateEmbedding: generateEmbeddingMock,
}));

vi.mock("../../src/core/code-index.js", () => ({
  readCodeIndex: readCodeIndexMock,
  findTopKCode: (
    q: number[],
    idx: Array<{ path: string; vector: number[]; chunkStart?: number; chunkName?: string }>,
    k: number,
  ) =>
    idx
      .map((e) => ({
        path: e.path,
        score: cosineSim(q, e.vector),
        chunkStart: e.chunkStart,
        chunkName: e.chunkName,
      }))
      .sort((a: { score: number }, b: { score: number }) => b.score - a.score)
      .slice(0, k),
  extractSnippet: (content: string) => {
    const lines = content.slice(0, 500).split("\n");
    const isComment = (l: string) => {
      const t = l.trim();
      if (t.startsWith("#!")) return true;
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return true;
      if (t === "#" || t.startsWith("# ")) return true;
      if (t === "---") return true;
      return false;
    };
    for (const line of lines) {
      const t = line.trim();
      if (t && !isComment(t)) return t.slice(0, 100);
    }
    for (const line of lines) {
      const t = line.trim();
      if (t) return t.slice(0, 100);
    }
    return "";
  },
  checkIndexStaleness: checkIndexStalenessMock,
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runSearch", () => {
  let tmpDir: string;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "search-test-"));
    await mkdir(join(tmpDir, ".phase2s"), { recursive: true });

    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation((_code?: number) => {
      throw new Error(`process.exit(${_code})`);
    });
    generateEmbeddingMock.mockReset();
    readCodeIndexMock.mockReset();
    checkIndexStalenessMock.mockReset();
    checkIndexStalenessMock.mockResolvedValue({ stale: false });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("exits 1 when ollamaBaseUrl is not configured", async () => {
    const { runSearch } = await import("../../src/cli/search.js");
    const config = { ollamaBaseUrl: undefined } as never;

    await expect(runSearch("auth", tmpDir, config)).rejects.toThrow("process.exit(1)");

    expect(exitSpy).toHaveBeenCalledWith(1);
    const errorOutput = consoleErrorSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(errorOutput).toMatch(/ollamaBaseUrl/);
  });

  it('prints "run phase2s sync first" when code-index.jsonl is absent', async () => {
    const { runSearch } = await import("../../src/cli/search.js");
    const config = { ollamaBaseUrl: "http://localhost:11434/v1" } as never;

    // No index file exists in tmpDir
    await expect(runSearch("auth", tmpDir, config)).rejects.toThrow("process.exit(1)");

    const errorOutput = consoleErrorSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(errorOutput).toMatch(/phase2s sync/);
  });

  it("prints top-K results with score and snippet", async () => {
    await writeFile(join(tmpDir, ".phase2s", "code-index.jsonl"), "");
    await writeFile(join(tmpDir, "auth.ts"), "export function authMiddleware() {}");

    generateEmbeddingMock.mockResolvedValue([1, 0, 0]);
    readCodeIndexMock.mockResolvedValue([
      { path: "auth.ts", hash: "abc", vector: [1, 0, 0], ts: new Date().toISOString(), model: "test" },
      { path: "session.ts", hash: "def", vector: [0, 1, 0], ts: new Date().toISOString(), model: "test" },
    ]);

    const { runSearch } = await import("../../src/cli/search.js");
    const config = {
      ollamaBaseUrl: "http://localhost:11434/v1",
      ollamaEmbedModel: "nomic-embed-text:latest",
    } as never;

    await runSearch("auth middleware", tmpDir, config, 2);

    const logOutput = consoleLogSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logOutput).toMatch(/auth\.ts/);
    expect(logOutput).toMatch(/1\.00|0\.\d+/);
  });

  it("prints snippet extraction — skips comment-only first line", async () => {
    await writeFile(join(tmpDir, ".phase2s", "code-index.jsonl"), "");
    await writeFile(join(tmpDir, "util.ts"), "// utility functions\nexport const util = {};\n");

    generateEmbeddingMock.mockResolvedValue([1, 0, 0]);
    readCodeIndexMock.mockResolvedValue([
      { path: "util.ts", hash: "abc", vector: [1, 0, 0], ts: new Date().toISOString(), model: "test" },
    ]);

    const { runSearch } = await import("../../src/cli/search.js");
    const config = { ollamaBaseUrl: "http://localhost:11434/v1" } as never;

    await runSearch("utility", tmpDir, config, 1);

    const logOutput = consoleLogSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logOutput).toMatch(/export const util/);
    expect(logOutput).not.toMatch(/utility functions/);
  });

  it("prints staleness warning when index is stale", async () => {
    await writeFile(join(tmpDir, ".phase2s", "code-index.jsonl"), "");

    generateEmbeddingMock.mockResolvedValue([1, 0, 0]);
    checkIndexStalenessMock.mockResolvedValue({
      stale: true,
      indexMtime: Date.now() - 60000,
      newestFileMtime: Date.now(),
      newestFile: "src/app.ts",
    });
    readCodeIndexMock.mockResolvedValue([
      { path: "app.ts", hash: "abc", vector: [1, 0, 0], ts: new Date().toISOString(), model: "test" },
    ]);

    const { runSearch } = await import("../../src/cli/search.js");
    const config = { ollamaBaseUrl: "http://localhost:11434/v1" } as never;

    await runSearch("query", tmpDir, config, 1);

    const logOutput = consoleLogSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logOutput).toMatch(/stale|sync/i);
  });

  it("exits 1 gracefully when Ollama is down (empty query vector)", async () => {
    await writeFile(join(tmpDir, ".phase2s", "code-index.jsonl"), "");

    generateEmbeddingMock.mockResolvedValue([]); // Ollama down

    const { runSearch } = await import("../../src/cli/search.js");
    const config = { ollamaBaseUrl: "http://localhost:11434/v1" } as never;

    await expect(runSearch("query", tmpDir, config)).rejects.toThrow("process.exit(1)");

    const errorOutput = consoleErrorSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(errorOutput).toMatch(/Ollama|embed/i);
  });

  it("displays path:N (1-indexed) for chunk entries (SR1)", async () => {
    await writeFile(join(tmpDir, ".phase2s", "code-index.jsonl"), "");
    // File with content at lines 0-9 so chunkStart=2 yields a real snippet
    const content = Array.from({ length: 15 }, (_, i) => `line${i}`).join("\n");
    await writeFile(join(tmpDir, "auth.ts"), content);

    generateEmbeddingMock.mockResolvedValue([1, 0, 0]);
    readCodeIndexMock.mockResolvedValue([
      {
        path: "auth.ts",
        hash: "abc",
        vector: [1, 0, 0],
        ts: new Date().toISOString(),
        model: "test",
        chunkStart: 2,
        chunkEnd: 6,
        chunkName: "function authMiddleware() {",
      },
    ]);

    const { runSearch } = await import("../../src/cli/search.js");
    const config = { ollamaBaseUrl: "http://localhost:11434/v1" } as never;

    await runSearch("auth", tmpDir, config, 1);

    const logOutput = consoleLogSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    // chunkStart=2 → displayed as line 3 (1-indexed)
    expect(logOutput).toMatch(/auth\.ts:3/);
  });

  it("appends chunkName label to chunk result output (SR4)", async () => {
    await writeFile(join(tmpDir, ".phase2s", "code-index.jsonl"), "");
    await writeFile(join(tmpDir, "auth.ts"), "function authMiddleware() {\n  return true;\n}\n");

    generateEmbeddingMock.mockResolvedValue([1, 0, 0]);
    readCodeIndexMock.mockResolvedValue([
      {
        path: "auth.ts",
        hash: "abc",
        vector: [1, 0, 0],
        ts: new Date().toISOString(),
        model: "test",
        chunkStart: 0,
        chunkEnd: 2,
        chunkName: "function authMiddleware() {",
      },
    ]);

    const { runSearch } = await import("../../src/cli/search.js");
    const config = { ollamaBaseUrl: "http://localhost:11434/v1" } as never;

    await runSearch("auth", tmpDir, config, 1);

    const logOutput = consoleLogSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logOutput).toMatch(/authMiddleware/);
  });

  it("uses chunk-based snippet (lines.slice) for chunk entries (SR3)", async () => {
    await writeFile(join(tmpDir, ".phase2s", "code-index.jsonl"), "");
    // Line 0 is unrelated; line 5 is the chunk content we want to appear
    const lines = [
      "// top-level comment",
      "const a = 1;",
      "const b = 2;",
      "const c = 3;",
      "const d = 4;",
      "export function targetFn() {", // chunkStart=5
      "  return true;",
      "}",
    ];
    await writeFile(join(tmpDir, "utils.ts"), lines.join("\n"));

    generateEmbeddingMock.mockResolvedValue([1, 0, 0]);
    readCodeIndexMock.mockResolvedValue([
      {
        path: "utils.ts",
        hash: "abc",
        vector: [1, 0, 0],
        ts: new Date().toISOString(),
        model: "test",
        chunkStart: 5,
        chunkEnd: 7,
        chunkName: "export function targetFn() {",
      },
    ]);

    const { runSearch } = await import("../../src/cli/search.js");
    const config = { ollamaBaseUrl: "http://localhost:11434/v1" } as never;

    await runSearch("targetFn", tmpDir, config, 1);

    const logOutput = consoleLogSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    // Chunk snippet reads lines[5..14], so "export function targetFn" should appear
    expect(logOutput).toMatch(/targetFn/);
    // The whole-file snippet would show "const a = 1;" (first non-comment line) — this should NOT appear
    expect(logOutput).not.toMatch(/const a = 1/);
  });
});
