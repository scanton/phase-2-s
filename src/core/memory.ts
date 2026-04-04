import { readFile } from "node:fs/promises";
import { join } from "node:path";

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
 * Trims oldest learnings first if the total character count exceeds MAX_LEARNINGS_CHARS.
 * This keeps the most recent decisions and preferences, which are most relevant.
 */
export function formatLearningsForPrompt(learnings: Learning[]): string {
  if (learnings.length === 0) return "";

  const lines = learnings.map((l) => `- [${l.key}]: ${l.insight}`);

  // Trim oldest first (front of array) until within char budget
  let trimmed = [...lines];
  while (trimmed.join("\n").length > MAX_LEARNINGS_CHARS && trimmed.length > 0) {
    trimmed = trimmed.slice(1);
  }

  if (trimmed.length === 0) return "";

  return [
    "## Project memory",
    "The following learnings from previous sessions apply to this project:",
    ...trimmed,
    `(${trimmed.length} learning${trimmed.length === 1 ? "" : "s"} loaded from .phase2s/memory/learnings.jsonl)`,
  ].join("\n");
}
