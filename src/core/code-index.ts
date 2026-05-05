/**
 * Semantic code index for Phase2S codebase search.
 *
 * Index file: .phase2s/code-index.jsonl
 * Each line is a CodeEntry JSON object.
 *
 * File discovery: `git ls-files --cached --others --exclude-standard`
 * — respects all .gitignore sources, includes untracked non-ignored files,
 *   no JS gitignore library needed.
 *
 * Staleness detection: SHA-256 of the first MAX_CODE_CHARS of each file.
 * Incremental: unchanged files (same hash + same model) are skipped.
 * GC: deleted or no-longer-discovered files are removed from the index.
 * Atomic write: PID-unique tmp + rename — prevents partial reads.
 *
 * Note: readCodeIndex() follows the same JSONL pattern as readIndex() in
 * search-index.ts (learnings index). The two indices are intentionally
 * separate — they solve different problems and GC independently.
 */

import { createHash } from "node:crypto";
import { readFile, writeFile, rename, stat, mkdir } from "node:fs/promises";
import { join, extname, resolve as resolvePath, sep } from "node:path";
import { spawn } from "node:child_process";
import { chunkFile, type Chunk } from "./chunker.js";

const CODE_INDEX_FILE = ".phase2s/code-index.jsonl";

/** Maximum characters of file content used for embedding. ~1,000 tokens —
 *  stays safely under the 2,048-token limit of common Ollama embed models
 *  (e.g. nomic-embed-text, gemma4). */
export const MAX_CODE_CHARS = 4_000;

export const INDEXABLE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".rb", ".go", ".rs", ".java", ".kt",
  ".c", ".cpp", ".h", ".cs", ".swift",
  ".md", ".mdx",
]);

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CodeEntry {
  /** Relative path from cwd */
  path: string;
  /** SHA-256 of truncated content (whole file) or chunk content */
  hash: string;
  vector: number[];
  ts: string;
  model: string;
  /** Present when this entry is a function/method chunk (0-indexed start line) */
  chunkStart?: number;
  /** Present when this entry is a function/method chunk (0-indexed end line, inclusive) */
  chunkEnd?: number;
  /** Present when this entry is a function/method chunk (first 80 chars of chunk source) */
  chunkName?: string;
}

export interface SyncResult {
  /** Files newly embedded or re-embedded */
  indexed: number;
  /** Unchanged files (hash + model matched) */
  skipped: number;
  /** GC'd entries (file deleted or no longer discovered) */
  removed: number;
  /** Files where embed failed (Ollama unavailable); stale entry preserved */
  failed: number;
  /** Total chunk entries indexed (0 when chunking unavailable or all whole-file) */
  chunks: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length !== a.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Composite cache key: "path\x00chunkStart" for chunk entries, "path" for whole-file.
 * Uses a NUL separator (not ":") to avoid collisions with files whose names contain
 * colon-number suffixes (e.g. "foo:10" would otherwise collide with chunk 10 of "foo").
 * Enables O(1) staleness lookup across both entry types.
 */
export function entryKey(path: string, chunkStart?: number): string {
  return chunkStart != null ? `${path}\x00${chunkStart}` : path;
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

/**
 * Discover all indexable source files in the git repo rooted at cwd.
 *
 * Spawns `git ls-files --cached --others --exclude-standard` which:
 *   - respects all .gitignore sources (root, per-directory, global)
 *   - includes untracked non-ignored files (--others --exclude-standard)
 *   - does NOT include ignored files
 *
 * Throws with a helpful message if cwd is not a git repository.
 * Returns relative paths sorted lexicographically, filtered by INDEXABLE_EXTENSIONS.
 */
export async function discoverFiles(cwd: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard"],
      { cwd, stdio: ["ignore", "pipe", "pipe"] },
    );

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on("error", (err) => {
      reject(new Error(`phase2s sync requires git in PATH: ${err.message}`));
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        const msg = stderr.trim();
        if (msg.includes("not a git repository") || msg.includes("fatal")) {
          reject(new Error("phase2s sync requires a git repository. Run this command from inside a git repo."));
        } else {
          reject(new Error(`git ls-files exited ${code}: ${msg || "(no output)"}`));
        }
        return;
      }

      const cwdNorm = resolvePath(cwd) + sep;
      const files = stdout
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => {
          if (!l || !INDEXABLE_EXTENSIONS.has(extname(l))) return false;
          // Path traversal guard: reject any path that escapes the repo root
          const abs = resolvePath(join(cwd, l));
          return abs.startsWith(cwdNorm) || abs === resolvePath(cwd);
        })
        .sort();

      resolve(files);
    });
  });
}

// ---------------------------------------------------------------------------
// Read / write index
// ---------------------------------------------------------------------------

/**
 * Read .phase2s/code-index.jsonl and return all valid entries.
 * Skips corrupt lines (same pattern as search-index.ts readIndex).
 * Returns [] on ENOENT or any read error.
 */
export async function readCodeIndex(cwd: string): Promise<CodeEntry[]> {
  const filePath = join(cwd, CODE_INDEX_FILE);
  try {
    const raw = await readFile(filePath, "utf-8");
    const entries: CodeEntry[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const entry = JSON.parse(trimmed) as CodeEntry;
        if (
          typeof entry.path === "string" &&
          typeof entry.hash === "string" &&
          Array.isArray(entry.vector)
        ) {
          entries.push(entry);
        }
      } catch {
        // Skip corrupt lines — entry will be re-embedded on next sync
      }
    }
    return entries;
  } catch {
    // ENOENT or parse error — return empty (fresh start)
    return [];
  }
}

async function writeCodeIndex(cwd: string, entries: CodeEntry[]): Promise<void> {
  // Ensure .phase2s/ exists (no-op if already present) — handles fresh repos
  await mkdir(join(cwd, ".phase2s"), { recursive: true });
  // Generate tmp path at call time to be safe in long-running processes (e.g. MCP server)
  const tmpPath = join(cwd, `${CODE_INDEX_FILE}.${process.pid}.${Date.now()}.tmp`);
  const finalPath = join(cwd, CODE_INDEX_FILE);
  const content = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  await writeFile(tmpPath, content, "utf-8");
  await rename(tmpPath, finalPath); // atomic on POSIX
}

// ---------------------------------------------------------------------------
// Snippet extraction
// ---------------------------------------------------------------------------

/**
 * Extract a short representative snippet from file content.
 *
 * First pass: find the first line in the initial 500 chars that is:
 *   - non-blank
 *   - not a shebang (#!)
 *   - not a comment-only line (// ... | # ... | * ... | /* ...)
 *   - not frontmatter (---)
 *
 * If no such line exists, fall back to the first non-blank line unconditionally.
 * Returns at most 100 characters.
 */
export function extractSnippet(content: string): string {
  const head = content.slice(0, 500);
  const lines = head.split("\n");

  const isComment = (line: string): boolean => {
    const t = line.trim();
    // Shebang
    if (t.startsWith("#!")) return true;
    // JS/TS double-slash comments and block comment lines
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return true;
    // Single-hash comment (Python/bash: `# text` or bare `#`)
    // Markdown headers (## Title, ### Section) are NOT comments — only `# ` or `#\n`
    if (t === "#" || t.startsWith("# ")) return true;
    // YAML/TOML frontmatter separator
    if (t === "---") return true;
    return false;
  };

  // First pass: prefer meaningful (non-comment) line
  for (const line of lines) {
    const t = line.trim();
    if (t && !isComment(t)) {
      return t.slice(0, 100);
    }
  }

  // Fallback: first non-blank line, even if comment
  for (const line of lines) {
    const t = line.trim();
    if (t) return t.slice(0, 100);
  }

  return "";
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

/**
 * Sync the code index with the current codebase.
 *
 * - Discovers files via git ls-files (throws on non-git cwd)
 * - Chunks each file via chunkFile() (AST-based for code, heading-based for Markdown)
 * - Falls back to whole-file embedding when chunkFile() returns []
 * - Two-phase embed to respect CONCURRENCY_CAP across all (file, chunk) pairs (D1):
 *     Phase 1: read files + compute hashes in CONCURRENCY_CAP batches, collect ChunkWork
 *     Phase 2: embed in batches of CHUNK_EMBED_CAP (flat across all files)
 * - D2: if all chunks for a file fail to embed on first transition, falls back to stale whole-file entry
 * - GCs entries whose paths are no longer discovered
 * - Atomically writes the updated index
 *
 * @param embedFn  Function that returns an embedding vector (or [] on error)
 * @param embedModel  Embed model name — cache invalidates when this changes
 */
const CONCURRENCY_CAP = 5;

/** Maximum parallel embed calls across all files in a Phase 2 batch */
const CHUNK_EMBED_CAP = 20;

interface ChunkWork {
  relPath: string;
  chunk: Chunk | null;  // null = whole-file
  text: string;         // content to embed (truncated)
  hash: string;
  cachedEntry: CodeEntry | null;
}

export async function syncCodebase(
  cwd: string,
  embedFn: (text: string) => Promise<number[]>,
  embedModel: string,
): Promise<SyncResult> {
  const discovered = await discoverFiles(cwd); // throws on non-git cwd
  const discoveredSet = new Set(discovered);

  // Load existing index keyed by entryKey(path, chunkStart?)
  const existing = new Map<string, CodeEntry>();
  for (const entry of await readCodeIndex(cwd)) {
    existing.set(entryKey(entry.path, entry.chunkStart), entry);
  }

  const updated: CodeEntry[] = [];
  let indexedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let chunkCount = 0;

  // ─── Phase 1: read files, compute hashes, collect work ─────────────────────
  // Process files in batches of CONCURRENCY_CAP to bound parallel I/O
  const allWork: ChunkWork[] = [];

  for (let i = 0; i < discovered.length; i += CONCURRENCY_CAP) {
    const batch = discovered.slice(i, i + CONCURRENCY_CAP);

    const batchWork = await Promise.all(
      batch.map(async (relPath): Promise<ChunkWork[]> => {
        let content: string;
        try {
          content = await readFile(join(cwd, relPath), "utf-8");
        } catch {
          // File disappeared between discovery and read — skip
          return [];
        }

        const chunks = chunkFile(content, relPath);

        if (chunks.length === 0) {
          // Whole-file path: truncate to MAX_CODE_CHARS
          const truncated = content.slice(0, MAX_CODE_CHARS);
          return [{
            relPath,
            chunk: null,
            text: truncated,
            hash: sha256(truncated),
            cachedEntry: existing.get(entryKey(relPath)) ?? null,
          }];
        }

        // Chunked path: one work item per chunk
        return chunks.map((chunk) => ({
          relPath,
          chunk,
          text: chunk.content.slice(0, MAX_CODE_CHARS),
          hash: sha256(chunk.content.slice(0, MAX_CODE_CHARS)),
          cachedEntry: existing.get(entryKey(relPath, chunk.start)) ?? null,
        }));
      }),
    );

    for (const workItems of batchWork) {
      allWork.push(...workItems);
    }
  }

  // Separate cached hits from work that needs embedding
  const toEmbed: ChunkWork[] = [];
  for (const work of allWork) {
    const cached = work.cachedEntry;
    if (cached && cached.hash === work.hash && cached.model === embedModel) {
      // Cache hit — carry forward as-is
      updated.push(cached);
      skippedCount++;
    } else {
      toEmbed.push(work);
    }
  }

  // ─── Phase 2: embed in CHUNK_EMBED_CAP batches (flat across all files) ──────
  // Track per-file embed outcomes for D2 fallback
  const fileEmbedSucceeded = new Map<string, boolean>();

  for (let i = 0; i < toEmbed.length; i += CHUNK_EMBED_CAP) {
    const batch = toEmbed.slice(i, i + CHUNK_EMBED_CAP);

    const results = await Promise.all(
      batch.map(async (work) => {
        const vector = await embedFn(work.text);
        if (vector.length === 0) {
          // Embed failed
          failedCount++;
          // Mark this file as having at least one failure (if not already succeeded)
          if (!fileEmbedSucceeded.get(work.relPath)) {
            fileEmbedSucceeded.set(work.relPath, false);
          }
          return null;
        }

        // Success
        fileEmbedSucceeded.set(work.relPath, true);
        indexedCount++;
        if (work.chunk != null) chunkCount++;

        const entry: CodeEntry = {
          path: work.relPath,
          hash: work.hash,
          vector,
          ts: new Date().toISOString(),
          model: embedModel,
        };
        if (work.chunk != null) {
          entry.chunkStart = work.chunk.start;
          entry.chunkEnd = work.chunk.end;
          entry.chunkName = work.chunk.name;
        }
        return entry;
      }),
    );

    for (const entry of results) {
      if (entry) updated.push(entry);
    }
  }

  // ─── D2: stale-entry fallback for files where all chunks failed to embed ─────
  // When Ollama is unavailable during re-embed, embed calls return [] and no new
  // entry is written. Without this block, the file would disappear from the index.
  //
  // Two cases to handle:
  //   (a) File was previously whole-file: existing key is entryKey(relPath) — a
  //       simple path string with no colon suffix.
  //   (b) File was previously chunked: existing keys are entryKey(relPath, N) for
  //       each chunk. entryKey(relPath) alone yields undefined here, so we must
  //       collect all existing entries whose .path matches relPath.
  for (const [relPath, succeeded] of fileEmbedSucceeded) {
    if (!succeeded) {
      const wholeFileKey = entryKey(relPath);
      const staleWholeFile = existing.get(wholeFileKey);
      if (staleWholeFile) {
        // Case (a): stale whole-file entry found
        updated.push(staleWholeFile);
      } else {
        // Case (b): file was previously chunked — preserve all stale chunk entries
        for (const entry of existing.values()) {
          if (entry.path === relPath) {
            updated.push(entry);
          }
        }
      }
    }
  }

  // ─── GC: count entries no longer in discovered set ───────────────────────────
  // Build a set of keys that made it into updated[] for O(1) lookup
  const updatedKeys = new Set(updated.map((u) => entryKey(u.path, u.chunkStart)));

  let removedCount = 0;
  for (const [key, entry] of existing) {
    if (!discoveredSet.has(entry.path)) {
      // File deleted or no longer tracked — GC it
      removedCount++;
    } else if (!updatedKeys.has(key)) {
      // Entry exists for a still-discovered file but was not carried forward.
      // This covers stale whole-file entries when a file upgraded to chunks,
      // and stale chunk entries when a file downgraded to whole-file.
      removedCount++;
    }
  }

  // Write full rewrite (not append) — same contract as search-index.ts writeIndex
  await writeCodeIndex(cwd, updated);

  return {
    indexed: indexedCount,
    skipped: skippedCount,
    removed: removedCount,
    failed: failedCount,
    chunks: chunkCount,
  };
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

/**
 * Return the top-K most semantically similar entries to queryVector.
 * Results sorted descending by cosine similarity.
 *
 * Returns [] when queryVector is empty or index is empty.
 * chunk fields (chunkStart, chunkName) are included when present.
 */
export function findTopKCode(
  queryVector: number[],
  index: CodeEntry[],
  k: number,
): Array<{ path: string; score: number; chunkStart?: number; chunkName?: string }> {
  if (queryVector.length === 0 || index.length === 0) return [];
  return index
    .map((entry) => ({
      path: entry.path,
      score: cosineSimilarity(queryVector, entry.vector),
      chunkStart: entry.chunkStart,
      chunkName: entry.chunkName,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

// ---------------------------------------------------------------------------
// Staleness check
// ---------------------------------------------------------------------------

/**
 * Check whether the code index is stale relative to the latest git commit.
 *
 * Uses `git log -1 --format=%ct HEAD` (one fast call) instead of stat-ing
 * every discovered file — avoids spawning a full ls-files on every search.
 *
 * Returns `{ stale: true, ... }` when the index exists but the HEAD commit
 * is newer than the index. Returns `{ stale: false }` if the index is
 * current, absent, or git is unavailable.
 */
export async function checkIndexStaleness(cwd: string): Promise<
  | { stale: false }
  | { stale: true; indexMtime: number; newestFileMtime: number; newestFile: string }
> {
  const indexPath = join(cwd, CODE_INDEX_FILE);

  let indexMtime: number;
  try {
    const s = await stat(indexPath);
    indexMtime = s.mtimeMs;
  } catch {
    return { stale: false }; // index absent — not stale, just missing
  }

  // One fast git call: get HEAD commit timestamp (unix seconds)
  const headCommitMs = await new Promise<number>((res) => {
    const proc = spawn("git", ["log", "-1", "--format=%ct", "HEAD"], {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let out = "";
    proc.stdout.on("data", (c: Buffer) => { out += c.toString(); });
    proc.on("close", (code) => {
      if (code !== 0) { res(0); return; }
      const ts = parseInt(out.trim(), 10);
      res(isNaN(ts) ? 0 : ts * 1000);
    });
    proc.on("error", () => res(0));
  });

  if (headCommitMs === 0) return { stale: false }; // git unavailable — skip

  if (headCommitMs > indexMtime) {
    return { stale: true, indexMtime, newestFileMtime: headCommitMs, newestFile: "HEAD commit" };
  }
  return { stale: false };
}
