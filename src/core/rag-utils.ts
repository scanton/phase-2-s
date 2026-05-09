/**
 * RAG utility helpers for Phase2S context injection.
 */

/**
 * Determine whether a turn input is too trivial to warrant code-RAG embedding.
 *
 * Trivial inputs are short UI responses ("yes", "no", "ok") or plain
 * 1–2-word acknowledgements that are not task queries. Colon commands
 * (e.g. ":help", ":compact", ":search foo") are always non-trivial —
 * they dispatch to command handlers that may query the index or produce
 * output requiring code context.
 *
 * Heuristic: word count <= 2 AND first token does not start with ':'.
 *
 * @example trivial     — "", "yes", "no", "ok", "yes please", "go ahead"
 * @example non-trivial — ":help", ":search foo", "fix the auth bug", "write tests"
 */
export function isTrivialInput(line: string): boolean {
  const parts = line.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return true;
  if (parts[0].startsWith(":")) return false; // colon commands always run
  return parts.length <= 2;
}
