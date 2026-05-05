import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import {
  discoverFiles,
  syncCodebase,
  readCodeIndex,
  findTopKCode,
  extractSnippet,
  entryKey,
  MAX_CODE_CHARS,
  INDEXABLE_EXTENSIONS,
} from "../../src/core/code-index.js";

// ---------------------------------------------------------------------------
// Git repo helpers
// ---------------------------------------------------------------------------

async function makeTempGitRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "phase2s-code-index-"));
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync('git config user.email "test@phase2s.test"', { cwd: dir, stdio: "pipe" });
  execSync('git config user.name "Phase2S Test"', { cwd: dir, stdio: "pipe" });
  await mkdir(join(dir, ".phase2s"), { recursive: true });
  return dir;
}

async function gitAdd(cwd: string, path: string): Promise<void> {
  execSync(`git add "${path}"`, { cwd, stdio: "pipe" });
}

async function gitCommit(cwd: string, msg = "test commit"): Promise<void> {
  execSync(`git commit -m "${msg}"`, { cwd, stdio: "pipe" });
}

async function gitAddAll(cwd: string): Promise<void> {
  execSync("git add -A", { cwd, stdio: "pipe" });
}

// ---------------------------------------------------------------------------
// Fake embed — deterministic, vector length 3
// ---------------------------------------------------------------------------

const fakeEmbed = (text: string): Promise<number[]> => {
  const code = [...text].reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return Promise.resolve([code % 10 / 10, (code * 2) % 10 / 10, (code * 3) % 10 / 10]);
};

// ---------------------------------------------------------------------------
// discoverFiles
// ---------------------------------------------------------------------------

describe("discoverFiles", () => {
  let dir: string;

  beforeEach(async () => { dir = await makeTempGitRepo(); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("discovers a committed .ts file", async () => {
    await writeFile(join(dir, "index.ts"), "export const x = 1;");
    await gitAdd(dir, "index.ts");
    await gitCommit(dir);

    const files = await discoverFiles(dir);
    expect(files).toContain("index.ts");
  });

  it("includes untracked (not committed) .ts files", async () => {
    await writeFile(join(dir, "untracked.ts"), "export const y = 2;");
    // Do NOT git add — should still appear via --others

    const files = await discoverFiles(dir);
    expect(files).toContain("untracked.ts");
  });

  it("excludes gitignored files", async () => {
    await writeFile(join(dir, ".gitignore"), "ignored.ts\n");
    await writeFile(join(dir, "ignored.ts"), "// ignored");
    await gitAddAll(dir);
    await gitCommit(dir);

    const files = await discoverFiles(dir);
    expect(files).not.toContain("ignored.ts");
  });

  it("excludes non-indexable extensions (.json)", async () => {
    await writeFile(join(dir, "config.json"), '{"key": "value"}');
    await gitAdd(dir, "config.json");
    await gitCommit(dir);

    const files = await discoverFiles(dir);
    expect(files).not.toContain("config.json");
  });

  it("throws when cwd is not a git repository", async () => {
    const nonGit = await mkdtemp(join(tmpdir(), "non-git-"));
    try {
      await expect(discoverFiles(nonGit)).rejects.toThrow(/git repository/);
    } finally {
      await rm(nonGit, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// syncCodebase
// ---------------------------------------------------------------------------

describe("syncCodebase", () => {
  let dir: string;

  beforeEach(async () => { dir = await makeTempGitRepo(); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("indexes a new file (indexed: 1, skipped: 0)", async () => {
    await writeFile(join(dir, "app.ts"), "export function run() {}");
    await gitAddAll(dir);
    await gitCommit(dir);

    const result = await syncCodebase(dir, fakeEmbed, "test-model");

    expect(result.indexed).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.removed).toBe(0);
    const index = await readCodeIndex(dir);
    expect(index).toHaveLength(1);
    expect(index[0].path).toBe("app.ts");
  });

  it("skips unchanged file on second run (skipped: 1)", async () => {
    await writeFile(join(dir, "stable.ts"), "export const VALUE = 42;");
    await gitAddAll(dir);
    await gitCommit(dir);

    await syncCodebase(dir, fakeEmbed, "test-model");

    const embedCalls: string[] = [];
    const trackingEmbed = (text: string) => { embedCalls.push(text); return fakeEmbed(text); };
    const result = await syncCodebase(dir, trackingEmbed, "test-model");

    expect(result.indexed).toBe(0);
    expect(result.skipped).toBe(1);
    expect(embedCalls).toHaveLength(0);
  });

  it("re-embeds updated file (indexed: 1 on second run)", async () => {
    await writeFile(join(dir, "changing.ts"), "export const a = 1;");
    await gitAddAll(dir);
    await gitCommit(dir);
    await syncCodebase(dir, fakeEmbed, "test-model");

    // Update the file
    await writeFile(join(dir, "changing.ts"), "export const a = 99; // updated");

    const embedCalls: string[] = [];
    const trackingEmbed = (text: string) => { embedCalls.push(text); return fakeEmbed(text); };
    const result = await syncCodebase(dir, trackingEmbed, "test-model");

    expect(result.indexed).toBe(1);
    expect(result.skipped).toBe(0);
    expect(embedCalls).toHaveLength(1);
  });

  it("re-embeds when embed model changes (same hash, different model)", async () => {
    await writeFile(join(dir, "app.ts"), "export function hello() {}");
    await gitAddAll(dir);
    await gitCommit(dir);
    await syncCodebase(dir, fakeEmbed, "model-a");

    const embedCalls: string[] = [];
    const trackingEmbed = (text: string) => { embedCalls.push(text); return fakeEmbed(text); };
    const result = await syncCodebase(dir, trackingEmbed, "model-b");

    expect(result.indexed).toBe(1);
    expect(embedCalls).toHaveLength(1);
  });

  it("removes deleted file from index (removed: 1)", async () => {
    await writeFile(join(dir, "gone.ts"), "export const x = 1;");
    await gitAddAll(dir);
    await gitCommit(dir);
    await syncCodebase(dir, fakeEmbed, "test-model");

    // Delete the file and commit the deletion
    execSync("git rm gone.ts", { cwd: dir, stdio: "pipe" });
    await gitCommit(dir, "remove gone.ts");

    const result = await syncCodebase(dir, fakeEmbed, "test-model");

    expect(result.removed).toBe(1);
    const index = await readCodeIndex(dir);
    expect(index.find((e) => e.path === "gone.ts")).toBeUndefined();
  });

  it("truncates large file at MAX_CODE_CHARS before embedding", async () => {
    const bigContent = "x".repeat(MAX_CODE_CHARS * 2);
    await writeFile(join(dir, "large.ts"), bigContent);
    await gitAddAll(dir);
    await gitCommit(dir);

    const embedInputs: string[] = [];
    const trackingEmbed = (text: string) => { embedInputs.push(text); return fakeEmbed(text); };
    await syncCodebase(dir, trackingEmbed, "test-model");

    expect(embedInputs.every((t) => t.length <= MAX_CODE_CHARS)).toBe(true);
  });

  it("leaves no .tmp file after sync completes (atomic write)", async () => {
    await writeFile(join(dir, "file.ts"), "export const ok = true;");
    await gitAddAll(dir);
    await gitCommit(dir);

    await syncCodebase(dir, fakeEmbed, "test-model");

    // No tmp files should remain
    const phase2sDir = join(dir, ".phase2s");
    const { readdirSync } = await import("node:fs");
    const files = readdirSync(phase2sDir);
    const tmpFiles = files.filter((f) => f.endsWith(".tmp"));
    expect(tmpFiles).toHaveLength(0);
  });

  it("skips file gracefully when embedFn returns [] (no corrupt entry)", async () => {
    await writeFile(join(dir, "app.ts"), "export function run() {}");
    await gitAddAll(dir);
    await gitCommit(dir);

    const failEmbed = (_text: string): Promise<number[]> => Promise.resolve([]);
    await syncCodebase(dir, failEmbed, "test-model");

    // File was not indexed (embed failed) but index is not corrupt
    const index = await readCodeIndex(dir);
    expect(index.find((e) => e.path === "app.ts")).toBeUndefined();
  });

  it("respects CHUNK_EMBED_CAP (never more than 20 embeds in-flight during Phase 2)", async () => {
    // Create 25 files — all one-liners so chunker returns [] → whole-file path
    // Phase 2 embeds them in batches of CHUNK_EMBED_CAP (20), so max in-flight ≤ 20
    for (let i = 0; i < 25; i++) {
      await writeFile(join(dir, `file${i}.ts`), `export const n${i} = ${i};`);
    }
    await gitAddAll(dir);
    await gitCommit(dir);

    let inFlight = 0;
    let maxInFlight = 0;

    const concurrencyTrackingEmbed = async (text: string): Promise<number[]> => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return fakeEmbed(text);
    };

    await syncCodebase(dir, concurrencyTrackingEmbed, "test-model");

    // Two-phase design: Phase 2 embeds in CHUNK_EMBED_CAP=20 batches
    expect(maxInFlight).toBeLessThanOrEqual(20);
    expect(maxInFlight).toBeGreaterThan(0);
  });

  it("includes chunks field in SyncResult (0 for whole-file only repos)", async () => {
    await writeFile(join(dir, "simple.ts"), `export const x = 1;`);
    await gitAddAll(dir);
    await gitCommit(dir);

    const result = await syncCodebase(dir, fakeEmbed, "test-model");
    expect(typeof result.chunks).toBe("number");
    expect(result.chunks).toBeGreaterThanOrEqual(0);
  });

  it("D2 regression: preserves stale whole-file entry when all embeds fail on first chunk transition", async () => {
    // Seed the index with a whole-file entry
    const content = "export const stable = true;";
    await writeFile(join(dir, "stable.ts"), content);
    await gitAddAll(dir);
    await gitCommit(dir);
    await syncCodebase(dir, fakeEmbed, "test-model");

    // Verify seeded
    let index = await readCodeIndex(dir);
    expect(index.find((e) => e.path === "stable.ts")).toBeDefined();

    // Now simulate Ollama going down — embed always returns []
    const failEmbed = (_text: string): Promise<number[]> => Promise.resolve([]);
    await syncCodebase(dir, failEmbed, "test-model");

    // D2: stale entry should be preserved (not wiped)
    index = await readCodeIndex(dir);
    expect(index.find((e) => e.path === "stable.ts")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// readCodeIndex
// ---------------------------------------------------------------------------

describe("readCodeIndex", () => {
  let dir: string;

  beforeEach(async () => { dir = await makeTempGitRepo(); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("returns [] when code-index.jsonl does not exist (ENOENT graceful)", async () => {
    const entries = await readCodeIndex(dir);
    expect(entries).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// findTopKCode
// ---------------------------------------------------------------------------

describe("findTopKCode", () => {
  const makeEntry = (path: string, vec: number[]) => ({
    path,
    hash: "abc",
    vector: vec,
    ts: new Date().toISOString(),
    model: "test",
  });

  const makeChunkEntry = (path: string, vec: number[], chunkStart: number) => ({
    ...makeEntry(path, vec),
    chunkStart,
    chunkEnd: chunkStart + 4,
    chunkName: `function at line ${chunkStart}`,
  });

  it("returns results sorted descending by cosine similarity", () => {
    const index = [
      makeEntry("c.ts", [0.1, 0.1, 0.9]),
      makeEntry("a.ts", [1, 0, 0]),
      makeEntry("b.ts", [0.5, 0.5, 0.1]),
    ];
    // Query most similar to a.ts
    const results = findTopKCode([1, 0, 0], index, 3);
    expect(results[0].path).toBe("a.ts");
    expect(results[0].score).toBeCloseTo(1.0, 5);
  });

  it("returns [] when index is empty", () => {
    expect(findTopKCode([1, 0, 0], [], 5)).toEqual([]);
  });

  it("returns [] when queryVector is empty", () => {
    const index = [makeEntry("a.ts", [1, 0, 0])];
    expect(findTopKCode([], index, 5)).toEqual([]);
  });

  it("returns all entries when k > index.length", () => {
    const index = [makeEntry("a.ts", [1, 0, 0]), makeEntry("b.ts", [0, 1, 0])];
    const results = findTopKCode([1, 0, 0], index, 10);
    expect(results).toHaveLength(2);
  });

  it("includes chunkStart and chunkName in results for chunk entries", () => {
    const index = [makeChunkEntry("auth.ts", [1, 0, 0], 10)];
    const results = findTopKCode([1, 0, 0], index, 1);
    expect(results[0].chunkStart).toBe(10);
    expect(results[0].chunkName).toBe("function at line 10");
  });

  it("chunkStart is undefined for whole-file entries", () => {
    const index = [makeEntry("app.ts", [1, 0, 0])];
    const results = findTopKCode([1, 0, 0], index, 1);
    expect(results[0].chunkStart).toBeUndefined();
    expect(results[0].chunkName).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// entryKey
// ---------------------------------------------------------------------------

describe("entryKey", () => {
  it("returns path for whole-file entry (chunkStart undefined)", () => {
    expect(entryKey("src/app.ts")).toBe("src/app.ts");
    expect(entryKey("src/app.ts", undefined)).toBe("src/app.ts");
  });

  it("returns path:N for chunk entry", () => {
    expect(entryKey("src/app.ts", 0)).toBe("src/app.ts:0");
    expect(entryKey("src/app.ts", 42)).toBe("src/app.ts:42");
  });

  it("produces distinct keys for different chunks of the same file", () => {
    expect(entryKey("auth.ts", 0)).not.toBe(entryKey("auth.ts", 10));
    expect(entryKey("auth.ts", 0)).not.toBe(entryKey("auth.ts"));
  });
});

// ---------------------------------------------------------------------------
// extractSnippet
// ---------------------------------------------------------------------------

describe("extractSnippet", () => {
  it("returns the first meaningful (non-comment) line", () => {
    const content = `// top comment\nexport function authMiddleware() {}`;
    expect(extractSnippet(content)).toBe("export function authMiddleware() {}");
  });

  it("skips shebang lines", () => {
    const content = `#!/usr/bin/env ts-node\nexport const cli = true;`;
    expect(extractSnippet(content)).toBe("export const cli = true;");
  });

  it("falls back to first non-blank line when all lines are comments", () => {
    const content = `// all\n// comments\n// here`;
    expect(extractSnippet(content)).toBe("// all");
  });

  it("returns first non-blank line for markdown content", () => {
    const content = `\n## Authentication\n\nThis section...`;
    expect(extractSnippet(content)).toBe("## Authentication");
  });

  it("skips frontmatter separators (---)", () => {
    const content = `---\ntitle: Example\n---\n# Title`;
    expect(extractSnippet(content)).toBe("title: Example");
  });

  it("truncates snippet at 100 chars", () => {
    const long = "export " + "x".repeat(200);
    expect(extractSnippet(long).length).toBeLessThanOrEqual(100);
  });
});
