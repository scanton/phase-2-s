import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Config } from "./config.js";
import { generateEmbedding } from "./embeddings.js";
import { getOrBuildIndex, findTopK } from "./search-index.js";

export interface Learning {
  key: string;
  insight: string;
  confidence?: number;
  type?: string;
  ts?: string;
}

const LEARNINGS_FILE = ".phase2s/memory/learnings.jsonl";
const MAX_LEARNINGS_CHARS = 2000;

/**
 * Load learnings from .phase2s/memory/learnings.jsonl.
 *
 * Returns an empty array if the file doesn't exist (first session, normal case).
 * Invalid JSON lines are skipped silently — a corrupted line shouldn't block
 * the rest of memory from loading.
 */
export async function loadLearnings(cwd: string): Promise<Learning[]> {
  const filePath = join(cwd, LEARNINGS_FILE);
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch {
    return [];
  }

  const results: Learning[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as Learning;
      // Require key and insight as non-empty strings — minimum viable learning
      if (typeof parsed.key === "string" && parsed.key.length > 0 &&
          typeof parsed.insight === "string" && parsed.insight.length > 0) {
        results.push(parsed);
      }
    } catch {
      // Skip invalid lines silently — don't block session startup on parse errors
    }
  }
  return results;
}

/**
 * Format learnings for injection into the system prompt.
 *
 * Returns an empty string if there are no learnings (no injection).
 * When skipCharCap is false (default), trims oldest learnings first if the
 * total character count exceeds MAX_LEARNINGS_CHARS.
 * When skipCharCap is true, bypasses the cap — used when semantic retrieval
 * already filtered to the most relevant subset.
 */
export function formatLearningsForPrompt(
  learnings: Learning[],
  options?: { skipCharCap?: boolean },
): string {
  if (learnings.length === 0) return "";

  const lines = learnings.map((l) => `- [${l.key}]: ${l.insight}`);

  let trimmed = [...lines];
  if (!options?.skipCharCap) {
    // Trim oldest first (front of array) until within char budget
    while (trimmed.join("\n").length > MAX_LEARNINGS_CHARS && trimmed.length > 0) {
      trimmed = trimmed.slice(1);
    }
  }

  if (trimmed.length === 0) return "";

  return [
    "## Project memory",
    "The following learnings from previous sessions apply to this project:",
    ...trimmed,
    `(${trimmed.length} learning${trimmed.length === 1 ? "" : "s"} loaded from .phase2s/memory/learnings.jsonl)`,
  ].join("\n");
}

/**
 * Compute a recency weight for a learning entry.
 * Returns 1.0 when ts is absent (treat as just-saved, no penalty).
 * Decays by 10% per day: weight = 1 / (1 + days * 0.1).
 */
function recencyWeight(ts: string | undefined): number {
  if (!ts) return 1.0;
  const days = (Date.now() - new Date(ts).getTime()) / 86_400_000;
  return isNaN(days) || days < 0 ? 1.0 : 1 / (1 + days * 0.1);
}

/**
 * Keyword/recency hybrid sort for non-Ollama learnings.
 *
 * Scores each learning by: (matched_terms / total_query_terms) * recencyWeight(ts).
 * Learnings with zero keyword overlap are not excluded — they fall to the bottom
 * and serve as a recency-ordered backstop. Sort is descending by score.
 */
export function heuristicSort(learnings: Learning[], queryText: string): Learning[] {
  const queryTerms = queryText.toLowerCase().match(/\w+/g) ?? [];
  if (queryTerms.length === 0) return [...learnings];

  return [...learnings].sort((a, b) => {
    const scoreFor = (l: Learning): number => {
      const text = `${l.key} ${l.insight}`.toLowerCase();
      const matched = queryTerms.filter((t) => text.includes(t)).length;
      return (matched / queryTerms.length) * recencyWeight(l.ts);
    };
    return scoreFor(b) - scoreFor(a);
  });
}

/**
 * Load the most relevant learnings for the given query text using Ollama embeddings.
 *
 * Falls back to heuristicSort (keyword/recency hybrid) when:
 * - ollamaBaseUrl is not configured
 * - the Ollama embed call fails (server down, model not pulled, etc.)
 *
 * Falls back to loadLearnings() (insertion order) when queryText is empty.
 */
export async function loadRelevantLearnings(
  cwd: string,
  queryText: string,
  config: Config,
  k = 8,
): Promise<Learning[]> {
  const ollamaBaseUrl = config.ollamaBaseUrl;
  if (!queryText.trim()) {
    return loadLearnings(cwd);
  }
  if (!ollamaBaseUrl) {
    const learnings = await loadLearnings(cwd);
    return heuristicSort(learnings, queryText);
  }

  const learnings = await loadLearnings(cwd);
  if (learnings.length === 0) return [];

  const embedModel = config.ollamaEmbedModel ?? "gemma4:latest";
  const embedFn = (text: string) => generateEmbedding(text, embedModel, ollamaBaseUrl);

  const queryVector = await embedFn(queryText);
  if (queryVector.length === 0) {
    // Ollama unreachable or embed model not available — fall back to keyword/recency
    return heuristicSort(learnings, queryText);
  }

  const index = await getOrBuildIndex(cwd, learnings, embedFn, embedModel);
  if (index.length === 0) return heuristicSort(learnings, queryText);

  const topKeys = findTopK(queryVector, index, k);
  if (topKeys.length === 0) return heuristicSort(learnings, queryText);

  const learningByKey = new Map(learnings.map((l) => [l.key, l]));
  return topKeys.flatMap((k) => {
    const l = learningByKey.get(k);
    return l ? [l] : [];
  });
}
