/**
 * RAG utility helpers for Phase2S context injection.
 */

/**
 * Determine whether a turn input is too trivial to warrant code-RAG embedding.
 *
 * Trivial inputs are single-word UI acks ("yes", "no", "ok") or the empty
 * string. Two-word inputs ("add tests", "fix typo", "yes please") are treated
 * as real task queries and will trigger RAG. Colon commands (e.g. ":help",
 * ":compact", ":search foo") are always non-trivial regardless of length —
 * they dispatch to command handlers that may query the index or produce
 * output requiring code context.
 *
 * Heuristic: word count <= minWords AND first token does not start with ':'.
 *
 * @param input    - The raw user input string.
 * @param minWords - Minimum word count to be considered non-trivial. Default 1
 *                   (single-word acks are trivial). Set to 0 to skip only empty
 *                   strings; set to 2 to allow single-word commands through RAG.
 *
 * @example trivial     (minWords=1) — "", "yes", "no", "ok", "sure"
 * @example non-trivial (minWords=1) — "yes please", "add tests", "go ahead",
 *                                     ":help", ":search foo", "fix the auth bug"
 * @example trivial     (minWords=0) — "" only
 * @example non-trivial (minWords=0) — "yes", "ok", "run", "go"
 */
export function isTrivialInput(input: string, minWords = 1): boolean {
  const parts = input.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return true;
  if (parts[0].startsWith(":")) return false; // colon commands always run
  return parts.length <= minWords;
}
