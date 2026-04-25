import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile, mkdir } from "node:fs/promises";
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

    const index = await getOrBuildIndex(tmpDir, learnings, trackingEmbed);

    expect(index).toHaveLength(1);
    expect(index[0].key).toBe("a");
    expect(embedCalls).toContain("always test");
  });

  it("re-embeds updated learnings (key present, hash changed)", async () => {
    const original: Learning[] = [{ key: "a", insight: "old insight" }];
    await getOrBuildIndex(tmpDir, original, fakeEmbed);

    const embedCalls: string[] = [];
    const trackingEmbed = (text: string) => { embedCalls.push(text); return fakeEmbed(text); };
    const updated: Learning[] = [{ key: "a", insight: "new insight changed" }];
    await getOrBuildIndex(tmpDir, updated, trackingEmbed);

    expect(embedCalls).toContain("new insight changed");
  });

  it("skips unchanged learnings (key + hash match)", async () => {
    const learnings: Learning[] = [{ key: "a", insight: "stable insight" }];
    await getOrBuildIndex(tmpDir, learnings, fakeEmbed);

    const embedCalls: string[] = [];
    const trackingEmbed = (text: string) => { embedCalls.push(text); return fakeEmbed(text); };
    await getOrBuildIndex(tmpDir, learnings, trackingEmbed);

    expect(embedCalls).toHaveLength(0);
  });

  it("GCs deleted learnings (key in index, absent from learnings file)", async () => {
    const original: Learning[] = [
      { key: "a", insight: "keep me" },
      { key: "b", insight: "remove me" },
    ];
    await getOrBuildIndex(tmpDir, original, fakeEmbed);

    const remaining: Learning[] = [{ key: "a", insight: "keep me" }];
    const index = await getOrBuildIndex(tmpDir, remaining, fakeEmbed);

    expect(index.map((e) => e.key)).toEqual(["a"]);
  });

  it("writes atomically (temp file + rename, not direct write)", async () => {
    const learnings: Learning[] = [{ key: "a", insight: "atomic write test" }];
    await getOrBuildIndex(tmpDir, learnings, fakeEmbed);

    // Temp file must not exist after write completes
    const tmpFile = join(tmpDir, ".phase2s/search-index.jsonl.tmp");
    const { existsSync } = await import("node:fs");
    expect(existsSync(tmpFile)).toBe(false);

    // Final file must exist
    const finalFile = join(tmpDir, ".phase2s/search-index.jsonl");
    expect(existsSync(finalFile)).toBe(true);
  });

  it("handles empty learnings list gracefully", async () => {
    const index = await getOrBuildIndex(tmpDir, [], fakeEmbed);
    expect(index).toHaveLength(0);
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
});
