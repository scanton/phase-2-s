/**
 * Semantic search index for Phase2S learnings.
 *
 * Index file: .phase2s/search-index.jsonl
 * Each line is a SearchEntry JSON object.
 *
 * Staleness detection uses SHA-256 of the insight text — catches both new
 * learnings and learnings whose text was updated in place.
 *
 * Atomic writes (temp file + rename) prevent parallel executor workers from
 * reading partial index files during concurrent goal runs.
 */

import { createHash } from "node:crypto";
import { readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import type { Learning } from "./memory.js";

const INDEX_FILE = ".phase2s/search-index.jsonl";
const INDEX_TMP_FILE = ".phase2s/search-index.jsonl.tmp";

interface SearchEntry {
  key: string;
  hash: string;
  vector: number[];
  ts: string;
}

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

async function readIndex(cwd: string): Promise<Map<string, SearchEntry>> {
  const filePath = join(cwd, INDEX_FILE);
  const map = new Map<string, SearchEntry>();
  try {
    const raw = await readFile(filePath, "utf-8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const entry = JSON.parse(trimmed) as SearchEntry;
        if (entry.key && Array.isArray(entry.vector)) {
          map.set(entry.key, entry);
        }
      } catch {
        // Skip corrupt lines — index will be rebuilt for affected entries
      }
    }
  } catch {
    // ENOENT or parse error — start fresh
  }
  return map;
}

async function writeIndex(cwd: string, entries: SearchEntry[]): Promise<void> {
  const tmpPath = join(cwd, INDEX_TMP_FILE);
  const finalPath = join(cwd, INDEX_FILE);
  const content = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  await writeFile(tmpPath, content, "utf-8");
  await rename(tmpPath, finalPath); // atomic on POSIX — prevents partial reads by parallel workers
}

/**
 * Build or incrementally update the search index.
 *
 * - New learnings are embedded and added.
 * - Learnings with changed text (hash mismatch) are re-embedded.
 * - Unchanged learnings reuse the existing vector.
 * - Learnings removed from the file are GC'd from the index.
 */
export async function getOrBuildIndex(
  cwd: string,
  learnings: Learning[],
  embedFn: (text: string) => Promise<number[]>,
): Promise<SearchEntry[]> {
  if (learnings.length === 0) return [];

  const existing = await readIndex(cwd);
  const updated: SearchEntry[] = [];
  let changed = false;

  for (const learning of learnings) {
    const hash = sha256(learning.insight);
    const cached = existing.get(learning.key);

    if (cached && cached.hash === hash) {
      updated.push(cached);
    } else {
      // New or updated learning — re-embed
      const vector = await embedFn(learning.insight);
      if (vector.length > 0) {
        updated.push({ key: learning.key, hash, vector, ts: new Date().toISOString() });
        changed = true;
      }
    }
  }

  // GC: keys in existing index that are no longer in learnings
  const learningKeys = new Set(learnings.map((l) => l.key));
  for (const key of existing.keys()) {
    if (!learningKeys.has(key)) changed = true; // entry was removed
  }

  if (changed) {
    await writeIndex(cwd, updated);
  }

  return updated;
}

/**
 * Return the keys of the top-K most semantically similar learnings.
 * Results are sorted highest-similarity-first.
 */
export function findTopK(queryVector: number[], index: SearchEntry[], k: number): string[] {
  if (queryVector.length === 0 || index.length === 0) return [];
  return index
    .map((entry) => ({ key: entry.key, score: cosineSimilarity(queryVector, entry.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((e) => e.key);
}
