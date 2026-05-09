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
 * Heuristic: word count <= 1 AND first token does not start with ':'.
 *
 * @example trivial     — "", "yes", "no", "ok", "sure"
 * @example non-trivial — "yes please", "add tests", "go ahead",
 *                        ":help", ":search foo", "fix the auth bug"
 */
export function isTrivialInput(line: string): boolean {
  const parts = line.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return true;
  if (parts[0].startsWith(":")) return false; // colon commands always run
  return parts.length <= 1;
}
