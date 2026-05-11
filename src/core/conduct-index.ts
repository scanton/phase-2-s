/**
 * Conduct index — persistent embedding sidecar for spec quality hints.
 *
 * Stores Ollama embeddings for past conduct-log goals in a JSON sidecar at
 * `.phase2s/conduct-index.json`. This enables O(1) cosine similarity lookup
 * during `runConduct()` without re-embedding all past goals on every run.
 *
 * Usage pattern:
 *   1. On runConduct() start: read index, embed current goal, cosine-search top-K.
 *   2. In finally block (after appendConductLog): upsert new entry into index.
 *   3. For --rebuild-index: truncate index, re-embed all entries from conduct-log.jsonl.
 *
 * Graceful degradation:
 *   - Missing or corrupt index file → returns empty index (never throws).
 *   - Ollama unavailable → generateEmbedding returns [] → entry skipped (never throws).
 *   - File write error → caller wraps in try/catch (same pattern as appendConductLog).
 *
 * Index schema version: 1
 * Index file: .phase2s/conduct-index.json
 */

import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConductIndexEntry {
  /** ISO 8601 timestamp — matches ConductLogEntry.ts, used as unique ID. */
  id: string;
  /** First 120 characters of the goal string. */
  goalSnippet: string;
  /** Ollama embedding vector. Empty array if embedding was unavailable at write time. */
  embedding: number[];
  /** Whether the conduct run succeeded (runGoal returned success). */
  success: boolean;
  /** Wall-clock ms of the run. Used for display in quality hints. */
  durationMs: number;
  /** Number of subtasks in the generated spec. */
  subtaskCount: number;
}

export interface ConductIndex {
  version: 1;
  entries: ConductIndexEntry[];
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Read the conduct index from `.phase2s/conduct-index.json`.
 *
 * Returns an empty index (version 1, entries: []) when the file is missing or
 * cannot be parsed — never throws.
 */
/** Validate a single index entry to prevent malformed data from flowing into search. */
function isValidEntry(e: unknown): e is ConductIndexEntry {
  if (!e || typeof e !== "object") return false;
  const entry = e as Record<string, unknown>;
  return (
    typeof entry["id"] === "string" &&
    typeof entry["goalSnippet"] === "string" &&
    Array.isArray(entry["embedding"]) &&
    (entry["embedding"] as unknown[]).length <= 8192 &&
    (entry["embedding"] as unknown[]).every((v) => typeof v === "number" && isFinite(v)) &&
    typeof entry["success"] === "boolean" &&
    typeof entry["durationMs"] === "number" && isFinite(entry["durationMs"] as number) &&
    typeof entry["subtaskCount"] === "number" && isFinite(entry["subtaskCount"] as number)
  );
}

export async function readConductIndex(cwd: string): Promise<ConductIndex> {
  const indexPath = join(cwd, ".phase2s", "conduct-index.json");
  try {
    const raw = await readFile(indexPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || parsed.version !== 1 || !Array.isArray(parsed.entries)) {
      return { version: 1, entries: [] };
    }
    // Validate each entry — skip malformed ones rather than casting blindly.
    const validEntries = (parsed.entries as unknown[]).filter(isValidEntry);
    return { version: 1, entries: validEntries };
  } catch {
    return { version: 1, entries: [] };
  }
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Write the full index back to disk, replacing the existing file.
 * Creates `.phase2s/` if it doesn't exist.
 *
 * @throws on unexpected I/O errors (caller should wrap in try/catch).
 */
export async function writeConductIndex(cwd: string, index: ConductIndex): Promise<void> {
  const phase2sDir = join(cwd, ".phase2s");
  await mkdir(phase2sDir, { recursive: true });
  const indexPath = join(phase2sDir, "conduct-index.json");
  const tmpPath = `${indexPath}.tmp`;
  // Compact serialization — this is a machine-read sidecar, pretty-printing wastes I/O.
  // Write to .tmp then rename to make the update atomic (prevents corrupt index on crash).
  // Note: concurrent upsertConductIndexEntry calls on separate processes can still race
  // (each reads stale index before the other writes). The index is a best-effort cache —
  // the authoritative data lives in conduct-log.jsonl; run --rebuild-index to recover.
  await writeFile(tmpPath, JSON.stringify(index), "utf8");
  await rename(tmpPath, indexPath);
}

// ---------------------------------------------------------------------------
// Upsert
// ---------------------------------------------------------------------------

/**
 * Upsert an entry into the conduct index.
 *
 * If an entry with the same `id` (ts) already exists, it is replaced. Otherwise
 * the entry is appended. Entries with empty embeddings (Ollama unavailable at
 * write time) are stored but excluded from cosine search results.
 *
 * @param cwd   Project working directory.
 * @param entry Entry to upsert (typically built from the just-appended ConductLogEntry).
 *
 * @throws on unexpected I/O errors (caller should wrap in try/catch).
 */
export async function upsertConductIndexEntry(cwd: string, entry: ConductIndexEntry): Promise<void> {
  const index = await readConductIndex(cwd);
  const existing = index.entries.findIndex((e) => e.id === entry.id);
  if (existing >= 0) {
    index.entries[existing] = entry;
  } else {
    index.entries.push(entry);
  }
  await writeConductIndex(cwd, index);
}

// ---------------------------------------------------------------------------
// Cosine similarity search
// ---------------------------------------------------------------------------

/**
 * Compute the cosine similarity between two equal-length vectors.
 * Returns 0 if either vector is empty or has zero magnitude.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  if (denom === 0) return 0;
  const result = dot / denom;
  // Guard against NaN/Infinity from degenerate vectors (e.g. Ollama returns Infinity floats).
  return isFinite(result) ? result : 0;
}

export interface ScoredIndexEntry extends ConductIndexEntry {
  similarity: number;
}

/**
 * Find the top-K most similar entries to a query embedding.
 *
 * Entries with empty embeddings are excluded (they cannot be scored).
 * Returns an array sorted by descending similarity, length ≤ topK.
 * Returns [] when queryVec is empty or the index has no embeddable entries.
 */
export function searchConductIndex(
  index: ConductIndex,
  queryVec: number[],
  topK: number,
): ScoredIndexEntry[] {
  if (queryVec.length === 0 || index.entries.length === 0) return [];

  const scored: ScoredIndexEntry[] = index.entries
    .filter((e) => e.embedding.length > 0)
    .map((e) => ({ ...e, similarity: cosineSimilarity(queryVec, e.embedding) }));

  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, topK);
}
