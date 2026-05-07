/**
 * Tests for src/tools/code-search.ts
 *
 * After Sprint 82 refactoring, the tool delegates the pipeline to searchCode()
 * from code-index.ts. Mocks: generateEmbedding, searchCode, checkIndexStaleness.
 * readFile and readCodeIndex/findTopKCode are no longer called by the tool directly.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

// ---------------------------------------------------------------------------
// Module-level mock references — vi.hoisted() ensures these are available
// before vi.mock() factory functions run (which are hoisted to top of file).
// ---------------------------------------------------------------------------

const {
  generateEmbeddingMock,
  searchCodeMock,
  checkIndexStalenessMock,
} = vi.hoisted(() => ({
  generateEmbeddingMock: vi.fn() as Mock,
  searchCodeMock: vi.fn() as Mock,
  checkIndexStalenessMock: vi.fn() as Mock,
}));

vi.mock("../../src/core/embeddings.js", () => ({
  generateEmbedding: generateEmbeddingMock,
}));

vi.mock("../../src/core/code-index.js", () => ({
  searchCode: searchCodeMock,
  checkIndexStaleness: checkIndexStalenessMock,
  // Keep other exports as stubs so TypeScript imports don't break
  findTopKCode: vi.fn(),
  readCodeIndex: vi.fn(),
  MIN_CODE_RAG_SCORE: 0.25,
  MAX_SNIPPET_LINES: 25,
}));

import { createCodeSearchTool } from "../../src/tools/code-search.js";
import type { CodeSearchResult } from "../../src/core/code-index.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CWD = "/project";
const BASE_URL = "http://localhost:11434/v1";
const EMBED_MODEL = "nomic-embed-text:latest";
const QUERY_VECTOR = [0.1, 0.2, 0.3];

const RESULT_WITH_CHUNK: CodeSearchResult = {
  path: "src/core/auth.ts",
  score: 0.912,
  chunkStart: 10,
  chunkEnd: 25,
  chunkName: "rateLimitBackoff",
  snippet: Array.from({ length: 16 }, (_, i) => `line ${i + 10}`).join("\n"),
};

const RESULT_WITHOUT_CHUNK: CodeSearchResult = {
  path: "src/utils/helper.ts",
  score: 0.741,
  snippet: "",
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tool: ReturnType<typeof createCodeSearchTool>;

beforeEach(() => {
  vi.clearAllMocks();
  tool = createCodeSearchTool(CWD, BASE_URL, EMBED_MODEL);

  // Default happy-path stubs
  generateEmbeddingMock.mockResolvedValue(QUERY_VECTOR);
  searchCodeMock.mockResolvedValue([]);
  checkIndexStalenessMock.mockResolvedValue({ stale: false });
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

    const result = await tool.execute({ query: "rate limit" });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Embedding failed/);
    expect(result.error).toContain(EMBED_MODEL);
    // searchCode must NOT be called — empty vector check is before it
    expect(searchCodeMock).not.toHaveBeenCalled();
  });

  it("returns success:false when generateEmbedding throws (Ollama crash path)", async () => {
    generateEmbeddingMock.mockRejectedValue(new Error("Ollama connection refused"));

    const result = await tool.execute({ query: "rate limit" });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Embedding failed/);
    expect(searchCodeMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Index load failure / no results
// ---------------------------------------------------------------------------

describe("createCodeSearchTool — index load failure", () => {
  it("returns success:true with sync hint when searchCode returns [] (missing index)", async () => {
    // searchCode() catches missing-index errors internally and returns []
    searchCodeMock.mockResolvedValue([]);

    const result = await tool.execute({ query: "rate limit" });

    expect(result.success).toBe(true);
    expect(result.output).toContain("phase2s sync");
  });

  it("still succeeds when checkIndexStaleness throws (non-git repo, etc.)", async () => {
    checkIndexStalenessMock.mockRejectedValue(new Error("not a git repository"));
    searchCodeMock.mockResolvedValue([RESULT_WITH_CHUNK]);

    // Staleness error is swallowed — results still returned
    const result = await tool.execute({ query: "rate limit" });

    expect(result.success).toBe(true);
    expect(result.output).toContain("src/core/auth.ts");
    // No staleness warning — error was swallowed
    expect(result.output).not.toMatch(/stale/i);
  });
});

// ---------------------------------------------------------------------------
// Path traversal guard (handled by searchCode — entry skipped, result absent)
// ---------------------------------------------------------------------------

describe("createCodeSearchTool — path traversal guard", () => {
  it("omits traversal-path entries when searchCode skips them (returns [])", async () => {
    // searchCode() already guards traversal — it returns [] for such entries
    searchCodeMock.mockResolvedValue([]);

    const result = await tool.execute({ query: "secrets" });

    expect(result.success).toBe(true);
    // No snippet content — no results above threshold
    expect(result.output).not.toContain("```");
  });
});

// ---------------------------------------------------------------------------
// No results
// ---------------------------------------------------------------------------

describe("createCodeSearchTool — no results", () => {
  it("returns success:true with sync hint when searchCode returns []", async () => {
    searchCodeMock.mockResolvedValue([]);

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
    searchCodeMock.mockResolvedValue([RESULT_WITH_CHUNK]);

    const result = await tool.execute({ query: "rate limit" });

    expect(result.success).toBe(true);
    expect(result.output).toContain("src/core/auth.ts");
    expect(result.output).toContain("10–25");
    expect(result.output).toContain("rateLimitBackoff");
    expect(result.output).toContain("0.912");
  });

  it("includes code snippet from searchCode result when snippet is present", async () => {
    searchCodeMock.mockResolvedValue([RESULT_WITH_CHUNK]);

    const result = await tool.execute({ query: "rate limit" });

    expect(result.output).toContain("```");
    expect(result.output).toContain("line 10");
  });

  it("omits snippet when chunk boundaries are absent", async () => {
    searchCodeMock.mockResolvedValue([RESULT_WITHOUT_CHUNK]);

    const result = await tool.execute({ query: "helper" });

    expect(result.success).toBe(true);
    // No snippet fences when snippet is empty
    expect(result.output).not.toContain("```");
  });

  it("omits snippet when searchCode provides empty snippet (file deleted since last sync)", async () => {
    const resultNoSnippet: CodeSearchResult = { ...RESULT_WITH_CHUNK, snippet: "" };
    searchCodeMock.mockResolvedValue([resultNoSnippet]);

    const result = await tool.execute({ query: "rate limit" });

    // Still succeeds — snippet is just omitted
    expect(result.success).toBe(true);
    expect(result.output).toContain("src/core/auth.ts");
    expect(result.output).not.toContain("```");
  });

  it("numbers results starting from [1]", async () => {
    searchCodeMock.mockResolvedValue([RESULT_WITH_CHUNK, RESULT_WITHOUT_CHUNK]);

    const result = await tool.execute({ query: "misc" });

    expect(result.output).toContain("[1]");
    expect(result.output).toContain("[2]");
  });

  it("passes k parameter through to searchCode", async () => {
    searchCodeMock.mockResolvedValue([RESULT_WITH_CHUNK]);

    await tool.execute({ query: "rate limit", k: 7 });

    expect(searchCodeMock).toHaveBeenCalledWith(
      CWD,
      QUERY_VECTOR,
      7,
    );
  });

  it("defaults to k=3 when k is omitted", async () => {
    searchCodeMock.mockResolvedValue([RESULT_WITH_CHUNK]);

    await tool.execute({ query: "rate limit" });

    expect(searchCodeMock).toHaveBeenCalledWith(
      CWD,
      QUERY_VECTOR,
      3,
    );
  });
});

// ---------------------------------------------------------------------------
// Staleness warning
// ---------------------------------------------------------------------------

describe("createCodeSearchTool — staleness", () => {
  it("prepends staleness warning when index is stale", async () => {
    searchCodeMock.mockResolvedValue([RESULT_WITH_CHUNK]);
    checkIndexStalenessMock.mockResolvedValue({ stale: true, newestFile: "src/new.ts" });

    const result = await tool.execute({ query: "rate limit" });

    expect(result.success).toBe(true);
    expect(result.output).toMatch(/stale/i);
    expect(result.output).toContain("src/new.ts");
  });

  it("does not include staleness text when index is current", async () => {
    searchCodeMock.mockResolvedValue([RESULT_WITH_CHUNK]);
    checkIndexStalenessMock.mockResolvedValue({ stale: false });

    const result = await tool.execute({ query: "rate limit" });

    expect(result.output).not.toMatch(/stale/i);
  });
});
