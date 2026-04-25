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
 * Load the most relevant learnings for the given query text using Ollama embeddings.
 *
 * Falls back to loadLearnings() when:
 * - queryText is empty (no task context, e.g. REPL startup)
 * - ollamaBaseUrl is not configured
 * - the Ollama embed call fails (server down, model not pulled, etc.)
 */
export async function loadRelevantLearnings(
  cwd: string,
  queryText: string,
  config: Config,
  k = 8,
): Promise<Learning[]> {
  const ollamaBaseUrl = config.ollamaBaseUrl;
  if (!queryText.trim() || !ollamaBaseUrl) {
    return loadLearnings(cwd);
  }

  const learnings = await loadLearnings(cwd);
  if (learnings.length === 0) return [];

  const embedModel = config.ollamaEmbedModel ?? config.model ?? "gemma4:latest";
  const embedFn = (text: string) => generateEmbedding(text, embedModel, ollamaBaseUrl);

  const queryVector = await embedFn(queryText);
  if (queryVector.length === 0) {
    // Ollama unreachable or embed model not available — fall back
    return learnings;
  }

  const index = await getOrBuildIndex(cwd, learnings, embedFn);
  if (index.length === 0) return learnings;

  const topKeys = findTopK(queryVector, index, k);
  if (topKeys.length === 0) return learnings;

  const keySet = new Set(topKeys);
  return learnings.filter((l) => keySet.has(l.key));
}
