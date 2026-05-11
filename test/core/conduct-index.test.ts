import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readConductIndex,
  upsertConductIndexEntry,
  searchConductIndex,
  cosineSimilarity,
  type ConductIndexEntry,
} from "../../src/core/conduct-index.js";

function makeEntry(overrides: Partial<ConductIndexEntry> = {}): ConductIndexEntry {
  return {
    id: "2024-01-01T00:00:00.000Z",
    goalSnippet: "add user authentication",
    embedding: [1, 0, 0],
    success: true,
    durationMs: 30000,
    subtaskCount: 4,
    ...overrides,
  };
}

describe("conduct-index", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "phase2s-ci-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // readConductIndex
  // ---------------------------------------------------------------------------

  it("returns empty index when file is missing", async () => {
    const index = await readConductIndex(tmpDir);
    expect(index.version).toBe(1);
    expect(index.entries).toEqual([]);
  });

  it("returns empty index on corrupt JSON", async () => {
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(join(tmpDir, ".phase2s"), { recursive: true });
    await writeFile(join(tmpDir, ".phase2s", "conduct-index.json"), "{bad json}", "utf8");
    const index = await readConductIndex(tmpDir);
    expect(index.entries).toEqual([]);
  });

  it("returns empty index on schema mismatch (version !== 1)", async () => {
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(join(tmpDir, ".phase2s"), { recursive: true });
    await writeFile(
      join(tmpDir, ".phase2s", "conduct-index.json"),
      JSON.stringify({ version: 99, entries: [] }),
      "utf8",
    );
    const index = await readConductIndex(tmpDir);
    expect(index.entries).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // upsertConductIndexEntry
  // ---------------------------------------------------------------------------

  it("creates the .phase2s/ dir and index file on first upsert", async () => {
    const entry = makeEntry();
    await upsertConductIndexEntry(tmpDir, entry);
    const index = await readConductIndex(tmpDir);
    expect(index.entries).toHaveLength(1);
    expect(index.entries[0].id).toBe(entry.id);
  });

  it("appends a new entry with a different id", async () => {
    await upsertConductIndexEntry(tmpDir, makeEntry({ id: "ts1" }));
    await upsertConductIndexEntry(tmpDir, makeEntry({ id: "ts2" }));
    const index = await readConductIndex(tmpDir);
    expect(index.entries).toHaveLength(2);
  });

  it("replaces an existing entry with the same id (idempotent upsert)", async () => {
    const entry = makeEntry({ success: false });
    await upsertConductIndexEntry(tmpDir, entry);
    const updated = { ...entry, success: true };
    await upsertConductIndexEntry(tmpDir, updated);
    const index = await readConductIndex(tmpDir);
    expect(index.entries).toHaveLength(1);
    expect(index.entries[0].success).toBe(true);
  });

  it("accepts entries with empty embeddings (Ollama unavailable)", async () => {
    await upsertConductIndexEntry(tmpDir, makeEntry({ embedding: [] }));
    const index = await readConductIndex(tmpDir);
    expect(index.entries[0].embedding).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // cosineSimilarity
  // ---------------------------------------------------------------------------

  it("returns 1.0 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1.0);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it("returns 0 for empty vector", () => {
    expect(cosineSimilarity([], [1, 2, 3])).toBe(0);
  });

  it("returns 0 for length mismatch", () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });

  it("returns 0 for zero-magnitude vector", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // searchConductIndex
  // ---------------------------------------------------------------------------

  it("returns empty array for empty query vector", async () => {
    await upsertConductIndexEntry(tmpDir, makeEntry());
    const index = await readConductIndex(tmpDir);
    expect(searchConductIndex(index, [], 3)).toEqual([]);
  });

  it("returns empty array when index has no embeddable entries", () => {
    const index = {
      version: 1 as const,
      entries: [makeEntry({ embedding: [] })],
    };
    expect(searchConductIndex(index, [1, 0, 0], 3)).toEqual([]);
  });

  it("ranks results by descending cosine similarity", async () => {
    // Three entries: perfect match, partial match, orthogonal
    await upsertConductIndexEntry(tmpDir, makeEntry({ id: "perfect", embedding: [1, 0, 0] }));
    await upsertConductIndexEntry(tmpDir, makeEntry({ id: "partial", embedding: [1, 1, 0] }));
    await upsertConductIndexEntry(tmpDir, makeEntry({ id: "ortho", embedding: [0, 0, 1] }));

    const index = await readConductIndex(tmpDir);
    const results = searchConductIndex(index, [1, 0, 0], 3);

    expect(results[0].id).toBe("perfect");
    expect(results[1].id).toBe("partial");
    expect(results[2].id).toBe("ortho");
    expect(results[0].similarity).toBeGreaterThan(results[1].similarity);
  });

  it("respects topK limit", async () => {
    for (let i = 0; i < 5; i++) {
      await upsertConductIndexEntry(
        tmpDir,
        makeEntry({ id: `e${i}`, embedding: [1, i * 0.1, 0] }),
      );
    }
    const index = await readConductIndex(tmpDir);
    const results = searchConductIndex(index, [1, 0, 0], 2);
    expect(results).toHaveLength(2);
  });

  it("attaches similarity score to each result", async () => {
    await upsertConductIndexEntry(tmpDir, makeEntry({ id: "a", embedding: [1, 0, 0] }));
    const index = await readConductIndex(tmpDir);
    const results = searchConductIndex(index, [1, 0, 0], 1);
    expect(typeof results[0].similarity).toBe("number");
    expect(results[0].similarity).toBeCloseTo(1.0);
  });
});
