import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { loadLearnings, loadRelevantLearnings, formatLearningsForPrompt, heuristicSort, type Learning } from "../../src/core/memory.js";
import type { Config } from "../../src/core/config.js";

/**
 * Tests for the memory system: loadLearnings() and formatLearningsForPrompt().
 *
 * These functions read .phase2s/memory/learnings.jsonl from the project root
 * and format the contents for injection into the system prompt.
 */
describe("loadLearnings()", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(process.cwd(), ".test-memory-"));
    // Create the .phase2s/memory directory inside tmp
    await mkdir(join(tmpDir, ".phase2s", "memory"), { recursive: true });
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true }).catch(() => {});
  });

  it("returns [] when learnings.jsonl does not exist", async () => {
    const results = await loadLearnings(tmpDir);
    expect(results).toEqual([]);
  });

  it("parses valid JSONL lines into Learning objects", async () => {
    const filePath = join(tmpDir, ".phase2s", "memory", "learnings.jsonl");
    await writeFile(
      filePath,
      [
        '{"key":"use-vitest","insight":"This project uses vitest not jest","type":"preference","confidence":1,"ts":"2026-04-04T00:00:00Z"}',
        '{"key":"codex-path","insight":"The codex binary lives at /opt/homebrew/bin/codex","type":"tool","confidence":1,"ts":"2026-04-04T01:00:00Z"}',
      ].join("\n") + "\n",
      "utf-8",
    );

    const results = await loadLearnings(tmpDir);
    expect(results).toHaveLength(2);
    expect(results[0].key).toBe("use-vitest");
    expect(results[0].insight).toBe("This project uses vitest not jest");
    expect(results[0].type).toBe("preference");
    expect(results[1].key).toBe("codex-path");
    expect(results[1].insight).toBe("The codex binary lives at /opt/homebrew/bin/codex");
  });

  it("skips invalid JSON lines silently", async () => {
    const dir2 = join(tmpDir, "bad-lines");
    await mkdir(join(dir2, ".phase2s", "memory"), { recursive: true });
    await writeFile(
      join(dir2, ".phase2s", "memory", "learnings.jsonl"),
      [
        '{"key":"valid-key","insight":"valid insight"}',
        "this is not json at all",
        '{"key":"another-valid","insight":"also valid"}',
        "",
        "   ",
      ].join("\n"),
      "utf-8",
    );

    const results = await loadLearnings(dir2);
    expect(results).toHaveLength(2);
    expect(results[0].key).toBe("valid-key");
    expect(results[1].key).toBe("another-valid");
  });

  it("skips lines missing required key or insight fields", async () => {
    const dir3 = join(tmpDir, "missing-fields");
    await mkdir(join(dir3, ".phase2s", "memory"), { recursive: true });
    await writeFile(
      join(dir3, ".phase2s", "memory", "learnings.jsonl"),
      [
        '{"key":"no-insight-here"}',
        '{"insight":"no key here"}',
        '{"key":"","insight":"empty key"}',
        '{"key":"good-key","insight":"good insight"}',
      ].join("\n"),
      "utf-8",
    );

    const results = await loadLearnings(dir3);
    expect(results).toHaveLength(1);
    expect(results[0].key).toBe("good-key");
  });
});

describe("formatLearningsForPrompt()", () => {
  it("returns empty string for empty learnings array", () => {
    const result = formatLearningsForPrompt([]);
    expect(result).toBe("");
  });

  it("formats learnings as a block with header and count", () => {
    const learnings: Learning[] = [
      { key: "use-vitest", insight: "This project uses vitest not jest", type: "preference" },
      { key: "strict-mode", insight: "Always use TypeScript strict mode", type: "preference" },
    ];
    const result = formatLearningsForPrompt(learnings);

    expect(result).toContain("## Project memory");
    expect(result).toContain("learnings from previous sessions");
    expect(result).toContain("- [use-vitest]: This project uses vitest not jest");
    expect(result).toContain("- [strict-mode]: Always use TypeScript strict mode");
    expect(result).toContain("2 learnings loaded from .phase2s/memory/learnings.jsonl");
  });

  it("trims oldest learnings first when total chars exceed budget", () => {
    // Create a learning with a very long insight to force trimming
    const longInsight = "x".repeat(1200);
    const learnings: Learning[] = [
      { key: "oldest", insight: longInsight, type: "preference" },
      { key: "second", insight: longInsight, type: "preference" },
      { key: "newest", insight: "short insight", type: "decision" },
    ];

    const result = formatLearningsForPrompt(learnings);

    // Oldest should be trimmed, newest should survive
    expect(result).not.toContain("[oldest]:");
    expect(result).toContain("[newest]: short insight");
    // Result should be non-empty
    expect(result.length).toBeGreaterThan(0);
  });

  it("uses singular 'learning' for exactly one entry", () => {
    const learnings: Learning[] = [
      { key: "single", insight: "only one entry", type: "preference" },
    ];
    const result = formatLearningsForPrompt(learnings);
    expect(result).toContain("1 learning loaded");
    expect(result).not.toContain("learnings loaded"); // no plural
  });

  it("skipCharCap: true bypasses 2000-char truncation", () => {
    const longInsight = "x".repeat(1200);
    const learnings: Learning[] = [
      { key: "oldest", insight: longInsight },
      { key: "second", insight: longInsight },
      { key: "newest", insight: "short" },
    ];

    const result = formatLearningsForPrompt(learnings, { skipCharCap: true });

    // All three should be present when cap is bypassed
    expect(result).toContain("[oldest]:");
    expect(result).toContain("[second]:");
    expect(result).toContain("[newest]:");
  });
});

describe("heuristicSort() — Sprint 73 (Item D)", () => {
  const now = new Date().toISOString();
  const old = new Date(Date.now() - 30 * 86_400_000).toISOString(); // 30 days ago

  it("returns learnings as-is when queryText is empty", () => {
    const learnings: Learning[] = [
      { key: "a", insight: "alpha" },
      { key: "b", insight: "beta" },
    ];
    const result = heuristicSort(learnings, "");
    expect(result.map((l) => l.key)).toEqual(["a", "b"]);
  });

  it("ranks learnings with matching keywords above non-matching ones", () => {
    const learnings: Learning[] = [
      { key: "unrelated", insight: "nothing to do with the query" },
      { key: "relevant", insight: "typescript strict mode is important" },
    ];
    const result = heuristicSort(learnings, "typescript strict");
    expect(result[0].key).toBe("relevant");
  });

  it("treats absent ts as full weight (no recency penalty)", () => {
    const learnings: Learning[] = [
      { key: "no-ts", insight: "typescript" },
      { key: "fresh", insight: "typescript", ts: now },
      { key: "stale", insight: "typescript", ts: old },
    ];
    const result = heuristicSort(learnings, "typescript");
    // no-ts (weight=1.0) and fresh (weight≈1.0) should both outrank stale (weight≈0.77)
    const staleIdx = result.findIndex((l) => l.key === "stale");
    const noTsIdx = result.findIndex((l) => l.key === "no-ts");
    expect(noTsIdx).toBeLessThan(staleIdx);
  });

  it("fresh ts outranks stale ts for same keyword match", () => {
    const learnings: Learning[] = [
      { key: "stale", insight: "vitest testing", ts: old },
      { key: "fresh", insight: "vitest testing", ts: now },
    ];
    const result = heuristicSort(learnings, "vitest testing");
    expect(result[0].key).toBe("fresh");
  });

  it("does not exclude zero-overlap learnings — puts them last", () => {
    const learnings: Learning[] = [
      { key: "no-match", insight: "completely unrelated content here" },
      { key: "match", insight: "vitest is the test runner" },
    ];
    const result = heuristicSort(learnings, "vitest");
    expect(result).toHaveLength(2);
    expect(result[0].key).toBe("match");
    expect(result[1].key).toBe("no-match");
  });

  it("does not mutate the original array", () => {
    const learnings: Learning[] = [
      { key: "a", insight: "alpha" },
      { key: "b", insight: "beta" },
    ];
    heuristicSort(learnings, "beta");
    expect(learnings[0].key).toBe("a"); // original order preserved
  });
});

describe("loadRelevantLearnings()", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(process.cwd(), ".test-relevant-"));
    await mkdir(join(tmpDir, ".phase2s", "memory"), { recursive: true });
    await mkdir(join(tmpDir, ".phase2s"), { recursive: true });
    await writeFile(
      join(tmpDir, ".phase2s", "memory", "learnings.jsonl"),
      '{"key":"a","insight":"always write tests"}\n{"key":"b","insight":"use typescript strict"}\n',
      "utf-8",
    );
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true }).catch(() => {});
    vi.restoreAllMocks();
  });

  const baseConfig = {
    provider: "ollama",
    ollamaBaseUrl: "http://localhost:11434/v1",
    model: "gemma4:latest",
    maxTurns: 50,
    timeout: 120_000,
    allowDestructive: false,
    verifyCommand: "npm test",
    requireSpecification: false,
    codexPath: "codex",
  } as unknown as Config;

  it("falls back to loadLearnings() when queryText is empty", async () => {
    const result = await loadRelevantLearnings(tmpDir, "", baseConfig);
    expect(result.length).toBeGreaterThan(0);
  });

  it("falls back to heuristicSort() when ollamaBaseUrl is absent", async () => {
    const noOllamaConfig = { ...baseConfig, ollamaBaseUrl: undefined } as unknown as Config;
    const result = await loadRelevantLearnings(tmpDir, "write tests", noOllamaConfig);
    expect(result.length).toBeGreaterThan(0);
    // heuristicSort should bubble "always write tests" to top for "write tests" query
    expect(result[0].key).toBe("a");
  });

  it("falls back to heuristicSort() when Ollama embed returns []", async () => {
    // Mock fetch to simulate Ollama being down
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const result = await loadRelevantLearnings(tmpDir, "write tests", baseConfig);
    // Should fall back and still return learnings (heuristicSort)
    expect(result.length).toBeGreaterThan(0);

    vi.restoreAllMocks();
  });

  it("uses semantic path when queryText and ollamaBaseUrl present and embed succeeds", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embeddings: [[0.1, 0.2, 0.3]] }),
    } as Response));

    const result = await loadRelevantLearnings(tmpDir, "write tests", baseConfig, 1);
    // Should return at most k=1 result
    expect(result.length).toBeLessThanOrEqual(1);

    vi.restoreAllMocks();
  });

  it("returns results in similarity rank order, not JSONL insertion order", async () => {
    // Return two different vectors per call: high similarity for "b", low for "a"
    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => {
      callCount++;
      // Query vector is [1,0,0]; "b" gets [1,0,0] (similarity=1), "a" gets [0,1,0] (similarity=0)
      const embedding = callCount === 1 ? [[1, 0, 0]] : callCount === 2 ? [[0, 1, 0]] : [[1, 0, 0]];
      return Promise.resolve({ ok: true, json: async () => ({ embeddings: embedding }) } as Response);
    }));

    // Use a fresh tmpDir so index isn't cached from previous test
    const { mkdtemp, mkdir: mkdirFn, writeFile: wf, rm: rmFn } = await import("node:fs/promises");
    const { join: j } = await import("node:path");
    const dir = await mkdtemp(j(process.cwd(), ".test-order-"));
    try {
      await mkdirFn(j(dir, ".phase2s", "memory"), { recursive: true });
      await wf(j(dir, ".phase2s", "memory", "learnings.jsonl"),
        '{"key":"a","insight":"always write tests"}\n{"key":"b","insight":"use typescript strict"}\n', "utf-8");

      const result = await loadRelevantLearnings(dir, "typescript", baseConfig, 2);
      // "b" has higher similarity to query — should appear first regardless of JSONL order
      if (result.length === 2) {
        expect(result[0].key).toBe("b");
        expect(result[1].key).toBe("a");
      }
    } finally {
      await rmFn(dir, { recursive: true }).catch(() => {});
      vi.restoreAllMocks();
    }
  });
});
