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
import { readFile, writeFile, rename, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { spawn } from "node:child_process";

const CODE_INDEX_FILE = ".phase2s/code-index.jsonl";
// Per-process unique tmp path prevents concurrent CLI instances from clobbering each other
const CODE_INDEX_TMP = `.phase2s/code-index.jsonl.${process.pid}.tmp`;

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
  /** SHA-256 of truncated content */
  hash: string;
  vector: number[];
  ts: string;
  model: string;
}

export interface SyncResult {
  /** Files newly embedded or re-embedded */
  indexed: number;
  /** Unchanged files (hash + model matched) */
  skipped: number;
  /** GC'd entries (file deleted or no longer discovered) */
  removed: number;
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

      const files = stdout
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && INDEXABLE_EXTENSIONS.has(extname(l)))
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
  const tmpPath = join(cwd, CODE_INDEX_TMP);
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
 * - Embeds files whose content SHA-256 or model has changed
 * - Embeds in parallel batches of up to CONCURRENCY_CAP (no new deps)
 * - GCs entries whose paths are no longer discovered
 * - Atomically writes the updated index
 *
 * @param embedFn  Function that returns an embedding vector (or [] on error)
 * @param embedModel  Embed model name — cache invalidates when this changes
 */
const CONCURRENCY_CAP = 5;

export async function syncCodebase(
  cwd: string,
  embedFn: (text: string) => Promise<number[]>,
  embedModel: string,
): Promise<SyncResult> {
  const discovered = await discoverFiles(cwd); // throws on non-git cwd
  const discoveredSet = new Set(discovered);

  // Load existing index keyed by path
  const existing = new Map<string, CodeEntry>();
  for (const entry of await readCodeIndex(cwd)) {
    existing.set(entry.path, entry);
  }

  const updated: CodeEntry[] = [];
  let indexedCount = 0;
  let skippedCount = 0;

  // Process in batches of CONCURRENCY_CAP
  for (let i = 0; i < discovered.length; i += CONCURRENCY_CAP) {
    const batch = discovered.slice(i, i + CONCURRENCY_CAP);

    const results = await Promise.all(
      batch.map(async (relPath) => {
        let content: string;
        try {
          content = await readFile(join(cwd, relPath), "utf-8");
        } catch {
          // File disappeared between discovery and read — skip it
          return null;
        }

        const truncated = content.slice(0, MAX_CODE_CHARS);
        const hash = sha256(truncated);
        const cached = existing.get(relPath);

        if (cached && cached.hash === hash && cached.model === embedModel) {
          skippedCount++;
          return cached;
        }

        // New, updated, or model-changed — embed
        const vector = await embedFn(truncated);
        if (vector.length === 0) {
          // Embed failed (Ollama down etc.) — skip this file this run
          return null;
        }
        indexedCount++;
        return {
          path: relPath,
          hash,
          vector,
          ts: new Date().toISOString(),
          model: embedModel,
        } satisfies CodeEntry;
      }),
    );

    for (const entry of results) {
      if (entry) updated.push(entry);
    }
  }

  // GC: count entries that are no longer in the discovered set
  let removedCount = 0;
  for (const path of existing.keys()) {
    if (!discoveredSet.has(path)) removedCount++;
  }

  // Write full rewrite (not append) — same contract as search-index.ts writeIndex
  await writeCodeIndex(cwd, updated);

  return { indexed: indexedCount, skipped: skippedCount, removed: removedCount };
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

/**
 * Return the top-K most semantically similar entries to queryVector.
 * Results sorted descending by cosine similarity.
 *
 * Returns [] when queryVector is empty or index is empty.
 */
export function findTopKCode(
  queryVector: number[],
  index: CodeEntry[],
  k: number,
): Array<{ path: string; score: number }> {
  if (queryVector.length === 0 || index.length === 0) return [];
  return index
    .map((entry) => ({ path: entry.path, score: cosineSimilarity(queryVector, entry.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

// ---------------------------------------------------------------------------
// Staleness check
// ---------------------------------------------------------------------------

/**
 * Check whether the code index is stale relative to the newest discovered source file.
 *
 * Returns `{ stale: true, indexMtime, newestFileMtime }` when the index exists but
 * at least one source file is newer. Returns `{ stale: false }` if the index is
 * current or does not exist (can't be stale if absent).
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

  let files: string[];
  try {
    files = await discoverFiles(cwd);
  } catch {
    return { stale: false }; // git not available — skip check
  }

  let newestFileMtime = 0;
  let newestFile = "";

  for (const relPath of files) {
    try {
      const s = await stat(join(cwd, relPath));
      if (s.mtimeMs > newestFileMtime) {
        newestFileMtime = s.mtimeMs;
        newestFile = relPath;
      }
    } catch {
      // File disappeared — skip
    }
  }

  if (newestFileMtime > indexMtime) {
    return { stale: true, indexMtime, newestFileMtime, newestFile };
  }
  return { stale: false };
}
