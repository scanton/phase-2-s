/**
 * Tests for src/tools/code-search.ts
 *
 * Mocks generateEmbedding, readCodeIndex, findTopKCode, checkIndexStaleness,
 * and readFile to exercise the tool logic without Ollama or disk I/O.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

// ---------------------------------------------------------------------------
// Module-level mock references — vi.hoisted() ensures these are available
// before vi.mock() factory functions run (which are hoisted to top of file).
// ---------------------------------------------------------------------------

const {
  generateEmbeddingMock,
  readCodeIndexMock,
  findTopKCodeMock,
  checkIndexStalenessMock,
  readFileMock,
} = vi.hoisted(() => ({
  generateEmbeddingMock: vi.fn() as Mock,
  readCodeIndexMock: vi.fn() as Mock,
  findTopKCodeMock: vi.fn() as Mock,
  checkIndexStalenessMock: vi.fn() as Mock,
  readFileMock: vi.fn() as Mock,
}));

vi.mock("../../src/core/embeddings.js", () => ({
  generateEmbedding: generateEmbeddingMock,
}));

vi.mock("../../src/core/code-index.js", () => ({
  findTopKCode: findTopKCodeMock,
  readCodeIndex: readCodeIndexMock,
  checkIndexStaleness: checkIndexStalenessMock,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    readFile: readFileMock,
  };
});

import { createCodeSearchTool } from "../../src/tools/code-search.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CWD = "/project";
const BASE_URL = "http://localhost:11434/v1";
const EMBED_MODEL = "nomic-embed-text:latest";
const QUERY_VECTOR = [0.1, 0.2, 0.3];

const RESULT_WITH_CHUNK = {
  path: "src/core/auth.ts",
  score: 0.912,
  chunkStart: 10,
  chunkEnd: 25,
  chunkName: "rateLimitBackoff",
};

const RESULT_WITHOUT_CHUNK = {
  path: "src/utils/helper.ts",
  score: 0.741,
  chunkStart: undefined,
  chunkEnd: undefined,
  chunkName: undefined,
};

const FILE_LINES = Array.from({ length: 30 }, (_, i) => `line ${i}`);
const FILE_CONTENT = FILE_LINES.join("\n");

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tool: ReturnType<typeof createCodeSearchTool>;

beforeEach(() => {
  vi.clearAllMocks();
  tool = createCodeSearchTool(CWD, BASE_URL, EMBED_MODEL);

  // Default happy-path stubs
  generateEmbeddingMock.mockResolvedValue(QUERY_VECTOR);
  readCodeIndexMock.mockResolvedValue([{ path: "src/core/auth.ts", vector: QUERY_VECTOR }]);
  findTopKCodeMock.mockReturnValue([]);
  checkIndexStalenessMock.mockResolvedValue({ stale: false });
  readFileMock.mockResolvedValue(FILE_CONTENT);
});

// ---------------------------------------------------------------------------
// Tool metadata
// ---------------------------------------------------------------------------

describe("createCodeSearchTool — metadata", () => {
  it("name is code_search", () => {
    expect(tool.name).toBe("code_search");
  });

  it("description mentions semantic search", () => {
    expect(tool.description).toContain("Semantic search");
  });

  it("parameters schema accepts query (required) and k (optional)", () => {
    // Valid — query only
    expect(() => (tool.parameters as import("zod").ZodType).parse({ query: "retry logic" })).not.toThrow();
    // Valid — query + k
    expect(() => (tool.parameters as import("zod").ZodType).parse({ query: "retry logic", k: 5 })).not.toThrow();
    // Invalid — missing query
    expect(() => (tool.parameters as import("zod").ZodType).parse({})).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Parameter schema boundary values
// ---------------------------------------------------------------------------

describe("createCodeSearchTool — parameter schema boundaries", () => {
  it("rejects k=0 (below min=1)", () => {
    expect(() => (tool.parameters as import("zod").ZodType).parse({ query: "x", k: 0 })).toThrow();
  });

  it("rejects k=21 (above max=20)", () => {
    expect(() => (tool.parameters as import("zod").ZodType).parse({ query: "x", k: 21 })).toThrow();
  });

  it("accepts k=1 (min boundary)", () => {
    expect(() => (tool.parameters as import("zod").ZodType).parse({ query: "x", k: 1 })).not.toThrow();
  });

  it("accepts k=20 (max boundary)", () => {
    expect(() => (tool.parameters as import("zod").ZodType).parse({ query: "x", k: 20 })).not.toThrow();
  });

  it("rejects fractional k (e.g. k=3.5)", () => {
    expect(() => (tool.parameters as import("zod").ZodType).parse({ query: "x", k: 3.5 })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Embedding failure
// ---------------------------------------------------------------------------

describe("createCodeSearchTool — embedding failure", () => {
  it("returns success:false with Ollama error when generateEmbedding returns []", async () => {
    generateEmbeddingMock.mockResolvedValue([]);
    findTopKCodeMock.mockReturnValue([]);

    const result = await tool.execute({ query: "rate limit" });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Embedding failed/);
    expect(result.error).toContain(EMBED_MODEL);
    // findTopKCode must NOT be called — empty vector check is before it
    expect(findTopKCodeMock).not.toHaveBeenCalled();
  });

  it("returns success:false when generateEmbedding throws (Ollama crash path)", async () => {
    generateEmbeddingMock.mockRejectedValue(new Error("Ollama connection refused"));

    const result = await tool.execute({ query: "rate limit" });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Embedding failed/);
    expect(findTopKCodeMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Index load failure
// ---------------------------------------------------------------------------

describe("createCodeSearchTool — index load failure", () => {
  it("returns success:false when readCodeIndex throws (missing or malformed index)", async () => {
    readCodeIndexMock.mockRejectedValue(new Error("ENOENT: no such file or directory"));

    const result = await tool.execute({ query: "rate limit" });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Failed to load code index/);
    expect(result.error).toContain("phase2s sync");
  });

  it("still succeeds when checkIndexStaleness throws (non-git repo, etc.)", async () => {
    checkIndexStalenessMock.mockRejectedValue(new Error("not a git repository"));
    findTopKCodeMock.mockReturnValue([RESULT_WITH_CHUNK]);

    // Staleness error is swallowed — results still returned
    const result = await tool.execute({ query: "rate limit" });

    expect(result.success).toBe(true);
    expect(result.output).toContain("src/core/auth.ts");
    // No staleness warning — error was swallowed
    expect(result.output).not.toMatch(/stale/i);
  });
});

// ---------------------------------------------------------------------------
// Path traversal guard
// ---------------------------------------------------------------------------

describe("createCodeSearchTool — path traversal guard", () => {
  it("omits snippet for index entries with traversal paths (e.g. ../../.env)", async () => {
    findTopKCodeMock.mockReturnValue([
      { ...RESULT_WITH_CHUNK, path: "../../.env" },
    ]);

    const result = await tool.execute({ query: "secrets" });

    // Should succeed but not include any snippet content from outside CWD
    expect(result.success).toBe(true);
    expect(result.output).not.toContain("```");
    // readFile must NOT have been called with the traversal path
    expect(readFileMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// No results
// ---------------------------------------------------------------------------

describe("createCodeSearchTool — no results", () => {
  it("returns success:true with sync hint when findTopKCode returns []", async () => {
    findTopKCodeMock.mockReturnValue([]);

    const result = await tool.execute({ query: "rate limit" });

    expect(result.success).toBe(true);
    expect(result.output).toContain("phase2s sync");
  });
});

// ---------------------------------------------------------------------------
// Happy path — results with chunk boundaries
// ---------------------------------------------------------------------------

describe("createCodeSearchTool — results present", () => {
  it("formats file path, line range, function name, and score", async () => {
    findTopKCodeMock.mockReturnValue([RESULT_WITH_CHUNK]);

    const result = await tool.execute({ query: "rate limit" });

    expect(result.success).toBe(true);
    expect(result.output).toContain("src/core/auth.ts");
    expect(result.output).toContain("10–25");
    expect(result.output).toContain("rateLimitBackoff");
    expect(result.output).toContain("0.912");
  });

  it("includes code snippet from file when chunkStart and chunkEnd are defined", async () => {
    findTopKCodeMock.mockReturnValue([RESULT_WITH_CHUNK]);

    const result = await tool.execute({ query: "rate limit" });

    // Snippet = lines 10..25 from FILE_CONTENT
    const expected = FILE_LINES.slice(10, 26).join("\n");
    expect(result.output).toContain(expected);
  });

  it("omits snippet when chunk boundaries are absent", async () => {
    findTopKCodeMock.mockReturnValue([RESULT_WITHOUT_CHUNK]);

    const result = await tool.execute({ query: "helper" });

    expect(result.success).toBe(true);
    // No snippet fences
    expect(result.output).not.toContain("```");
  });

  it("omits snippet when readFile throws (file deleted since last sync)", async () => {
    findTopKCodeMock.mockReturnValue([RESULT_WITH_CHUNK]);
    readFileMock.mockRejectedValue(new Error("ENOENT: no such file"));

    const result = await tool.execute({ query: "rate limit" });

    // Still succeeds — snippet is just omitted
    expect(result.success).toBe(true);
    expect(result.output).toContain("src/core/auth.ts");
    expect(result.output).not.toContain("```");
  });

  it("numbers results starting from [1]", async () => {
    findTopKCodeMock.mockReturnValue([RESULT_WITH_CHUNK, RESULT_WITHOUT_CHUNK]);

    const result = await tool.execute({ query: "misc" });

    expect(result.output).toContain("[1]");
    expect(result.output).toContain("[2]");
  });

  it("passes k parameter through to findTopKCode", async () => {
    findTopKCodeMock.mockReturnValue([RESULT_WITH_CHUNK]);

    await tool.execute({ query: "rate limit", k: 7 });

    expect(findTopKCodeMock).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Array),
      7,
    );
  });

  it("defaults to k=3 when k is omitted", async () => {
    findTopKCodeMock.mockReturnValue([RESULT_WITH_CHUNK]);

    await tool.execute({ query: "rate limit" });

    expect(findTopKCodeMock).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Array),
      3,
    );
  });
});

// ---------------------------------------------------------------------------
// Staleness warning
// ---------------------------------------------------------------------------

describe("createCodeSearchTool — staleness", () => {
  it("prepends staleness warning when index is stale", async () => {
    findTopKCodeMock.mockReturnValue([RESULT_WITH_CHUNK]);
    checkIndexStalenessMock.mockResolvedValue({ stale: true, newestFile: "src/new.ts" });

    const result = await tool.execute({ query: "rate limit" });

    expect(result.success).toBe(true);
    expect(result.output).toMatch(/stale/i);
    expect(result.output).toContain("src/new.ts");
  });

  it("does not include staleness text when index is current", async () => {
    findTopKCodeMock.mockReturnValue([RESULT_WITH_CHUNK]);
    checkIndexStalenessMock.mockResolvedValue({ stale: false });

    const result = await tool.execute({ query: "rate limit" });

    expect(result.output).not.toMatch(/stale/i);
  });
});
