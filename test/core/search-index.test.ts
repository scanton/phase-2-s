import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { getOrBuildIndex, findTopK } from "../../src/core/search-index.js";
import type { Learning } from "../../src/core/memory.js";

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "search-index-test-"));
  return dir;
}

const fakeEmbed = (text: string): Promise<number[]> => {
  // Simple deterministic fake: hash text into a 3-dim vector
  const code = [...text].reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return Promise.resolve([code % 10 / 10, (code * 2) % 10 / 10, (code * 3) % 10 / 10]);
};

describe("getOrBuildIndex", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = makeTmpDir();
    await mkdir(join(tmpDir, ".phase2s"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("embeds new learnings (key absent from index)", async () => {
    const learnings: Learning[] = [{ key: "a", insight: "always test" }];
    const embedCalls: string[] = [];
    const trackingEmbed = (text: string) => { embedCalls.push(text); return fakeEmbed(text); };

    const index = await getOrBuildIndex(tmpDir, learnings, trackingEmbed, "test-model");

    expect(index).toHaveLength(1);
    expect(index[0].key).toBe("a");
    expect(embedCalls).toContain("always test");
  });

  it("re-embeds updated learnings (key present, hash changed)", async () => {
    const original: Learning[] = [{ key: "a", insight: "old insight" }];
    await getOrBuildIndex(tmpDir, original, fakeEmbed, "test-model");

    const embedCalls: string[] = [];
    const trackingEmbed = (text: string) => { embedCalls.push(text); return fakeEmbed(text); };
    const updated: Learning[] = [{ key: "a", insight: "new insight changed" }];
    await getOrBuildIndex(tmpDir, updated, trackingEmbed, "test-model");

    expect(embedCalls).toContain("new insight changed");
  });

  it("skips unchanged learnings (key + hash match)", async () => {
    const learnings: Learning[] = [{ key: "a", insight: "stable insight" }];
    await getOrBuildIndex(tmpDir, learnings, fakeEmbed, "test-model");

    const embedCalls: string[] = [];
    const trackingEmbed = (text: string) => { embedCalls.push(text); return fakeEmbed(text); };
    await getOrBuildIndex(tmpDir, learnings, trackingEmbed, "test-model");

    expect(embedCalls).toHaveLength(0);
  });

  it("GCs deleted learnings (key in index, absent from learnings file)", async () => {
    const original: Learning[] = [
      { key: "a", insight: "keep me" },
      { key: "b", insight: "remove me" },
    ];
    await getOrBuildIndex(tmpDir, original, fakeEmbed, "test-model");

    const remaining: Learning[] = [{ key: "a", insight: "keep me" }];
    const index = await getOrBuildIndex(tmpDir, remaining, fakeEmbed, "test-model");

    expect(index.map((e) => e.key)).toEqual(["a"]);
  });

  it("writes atomically (temp file + rename, not direct write)", async () => {
    const learnings: Learning[] = [{ key: "a", insight: "atomic write test" }];
    await getOrBuildIndex(tmpDir, learnings, fakeEmbed, "test-model");

    // PID-unique temp file must not exist after write completes
    const tmpFile = join(tmpDir, `.phase2s/search-index.jsonl.${process.pid}.tmp`);
    const { existsSync } = await import("node:fs");
    expect(existsSync(tmpFile)).toBe(false);

    // Final file must exist
    const finalFile = join(tmpDir, ".phase2s/search-index.jsonl");
    expect(existsSync(finalFile)).toBe(true);
  });

  it("retries embed on next run when embedFn returns [] (changed=true)", async () => {
    const learnings: Learning[] = [{ key: "a", insight: "retry me" }];
    const failingEmbed = (_text: string): Promise<number[]> => Promise.resolve([]);

    // First run: embed fails, no entry is added
    const firstIndex = await getOrBuildIndex(tmpDir, learnings, failingEmbed, "test-model");
    expect(firstIndex).toHaveLength(0);

    // Second run: embed succeeds — entry should now be embedded (not skipped as "unchanged")
    const embedCalls: string[] = [];
    const succeedingEmbed = (text: string) => { embedCalls.push(text); return fakeEmbed(text); };
    const secondIndex = await getOrBuildIndex(tmpDir, learnings, succeedingEmbed, "test-model");

    expect(embedCalls).toContain("retry me");
    expect(secondIndex).toHaveLength(1);
    expect(secondIndex[0].key).toBe("a");
  });

  it("skips corrupt JSONL lines without crashing", async () => {
    const { writeFile } = await import("node:fs/promises");
    // Write a partially corrupt index — two valid entries, one garbage line
    // Hashes are SHA-256 of the insight strings
    const corruptContent = [
      '{"key":"a","hash":"4137145e59e527aa449cc1f0ffad8d02d9adeab84ef151f7b7e3d1346e5f90cf","vector":[0.1,0.2],"ts":"","model":"test-model"}',
      "NOT_JSON{{{",
      '{"key":"b","hash":"80ea378a2a6d8da2f8d2051d7be8d6ff87661cf1aeede55bb410ed51575a654c","vector":[0.3,0.4],"ts":"","model":"test-model"}',
    ].join("\n") + "\n";
    await writeFile(join(tmpDir, ".phase2s/search-index.jsonl"), corruptContent, "utf-8");

    const learnings: Learning[] = [
      { key: "a", insight: "already indexed" },
      { key: "b", insight: "also indexed" },
    ];
    const embedCalls: string[] = [];
    const trackingEmbed = (text: string) => { embedCalls.push(text); return fakeEmbed(text); };
    const index = await getOrBuildIndex(tmpDir, learnings, trackingEmbed, "test-model");

    // Valid entries should be preserved without re-embedding
    expect(embedCalls).toHaveLength(0);
    expect(index.map((e) => e.key).sort()).toEqual(["a", "b"]);
  });

  it("handles empty learnings list gracefully", async () => {
    const index = await getOrBuildIndex(tmpDir, [], fakeEmbed, "test-model");
    expect(index).toHaveLength(0);
  });

  // --- Item C: model staleness tests ---

  it("re-embeds when model changes (same hash, different model)", async () => {
    const learnings: Learning[] = [{ key: "a", insight: "model staleness test" }];
    await getOrBuildIndex(tmpDir, learnings, fakeEmbed, "model-v1");

    const embedCalls: string[] = [];
    const trackingEmbed = (text: string) => { embedCalls.push(text); return fakeEmbed(text); };
    await getOrBuildIndex(tmpDir, learnings, trackingEmbed, "model-v2");

    expect(embedCalls).toContain("model staleness test");
  });

  it("treats old index entry without model field as cache miss (re-embeds once)", async () => {
    const { writeFile } = await import("node:fs/promises");
    // Write an old-format entry — no model field
    const oldContent =
      '{"key":"a","hash":"4137145e59e527aa449cc1f0ffad8d02d9adeab84ef151f7b7e3d1346e5f90cf","vector":[0.1,0.2],"ts":""}\n';
    await writeFile(join(tmpDir, ".phase2s/search-index.jsonl"), oldContent, "utf-8");

    const learnings: Learning[] = [{ key: "a", insight: "already indexed" }];
    const embedCalls: string[] = [];
    const trackingEmbed = (text: string) => { embedCalls.push(text); return fakeEmbed(text); };

    // First run with model — old entry has no model, must re-embed
    const firstIndex = await getOrBuildIndex(tmpDir, learnings, trackingEmbed, "test-model");
    expect(embedCalls).toContain("already indexed");
    expect(firstIndex[0].model).toBe("test-model");

    // Second run — now cached with model field, should NOT re-embed
    embedCalls.length = 0;
    await getOrBuildIndex(tmpDir, learnings, trackingEmbed, "test-model");
    expect(embedCalls).toHaveLength(0);
  });

  it("cache hit when same model + same hash (existing behavior preserved)", async () => {
    const learnings: Learning[] = [{ key: "a", insight: "cache me" }];
    await getOrBuildIndex(tmpDir, learnings, fakeEmbed, "stable-model");

    const embedCalls: string[] = [];
    const trackingEmbed = (text: string) => { embedCalls.push(text); return fakeEmbed(text); };
    await getOrBuildIndex(tmpDir, learnings, trackingEmbed, "stable-model");

    expect(embedCalls).toHaveLength(0);
  });
});

describe("findTopK", () => {
  it("returns top-K keys by cosine similarity", () => {
    const index = [
      { key: "a", hash: "h1", vector: [1, 0, 0], ts: "" },
      { key: "b", hash: "h2", vector: [0, 1, 0], ts: "" },
      { key: "c", hash: "h3", vector: [0.9, 0.1, 0], ts: "" },
    ];
    const query = [1, 0, 0];
    const result = findTopK(query, index, 2);
    // "a" (perfect match) and "c" (close) should rank above "b"
    expect(result[0]).toBe("a");
    expect(result[1]).toBe("c");
    expect(result).toHaveLength(2);
  });

  it("handles empty index gracefully", () => {
    const result = findTopK([1, 0, 0], [], 5);
    expect(result).toEqual([]);
  });

  it("handles empty query vector gracefully", () => {
    const index = [{ key: "a", hash: "h1", vector: [1, 0], ts: "" }];
    const result = findTopK([], index, 1);
    expect(result).toEqual([]);
  });

  it("returns all entries when k > index.length", () => {
    const index = [
      { key: "a", hash: "h1", vector: [1, 0, 0], ts: "" },
      { key: "b", hash: "h2", vector: [0, 1, 0], ts: "" },
    ];
    const result = findTopK([1, 0, 0], index, 100);
    expect(result).toHaveLength(2);
  });
});
