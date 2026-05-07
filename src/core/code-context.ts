/**
 * Builds the [PHASE2S_CODE_CONTEXT] block injected as a rolling user message
 * before each REPL turn when code-RAG is active.
 *
 * Mirrors the [PHASE2S_LEARNINGS] pattern in conversation.ts / agent.ts.
 *
 * The block format is:
 *   [PHASE2S_CODE_CONTEXT]
 *   <code_context>
 *   [1] path/to/file.ts (functionName) — score 0.812
 *   ```
 *   <snippet>
 *   ```
 *   ...
 *   </code_context>
 */

import type { CodeSearchResult } from "./code-index.js";

/**
 * Format top-K code search results into an injection block.
 *
 * Returns null when results is empty so callers can call
 * agent.refreshCodeContext(null) to clear the marker.
 */
export function buildCodeContextBlock(results: CodeSearchResult[]): string | null {
  if (results.length === 0) return null;

  const entries = results.map((r, i) => {
    const header =
      `[${i + 1}] ${r.path}` +
      (r.chunkName ? ` (${r.chunkName})` : "") +
      ` — score ${r.score.toFixed(3)}`;
    const body = r.snippet ? `\`\`\`\n${r.snippet}\n\`\`\`` : "(no snippet)";
    return `${header}\n${body}`;
  });

  return `<code_context>\n${entries.join("\n\n")}\n</code_context>`;
}
