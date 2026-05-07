/**
 * code_search agent tool — semantic search over the code index.
 *
 * Registered in createDefaultRegistry() when both ollamaBaseUrl and
 * ollamaEmbedModel are set in RegistryOptions. Absent otherwise so the
 * agent tool list never shows a broken tool for non-Ollama users.
 *
 * Pipeline: embed query via Ollama → load .phase2s/code-index.jsonl →
 * cosine rank via findTopKCode → read file lines for snippet display.
 *
 * Distinct from src/cli/search.ts (which implements the :search REPL command).
 * Both use the same underlying findTopKCode function.
 */

import { z } from "zod";
import { generateEmbedding } from "../core/embeddings.js";
import { searchCode, checkIndexStaleness } from "../core/code-index.js";
import type { ToolDefinition, ToolResult } from "./types.js";

const params = z.object({
  query: z.string().describe("Natural language search query"),
  k: z.number().int().min(1).max(20).optional().describe("Max results to return (default 3)"),
});

export function createCodeSearchTool(
  cwd: string,
  ollamaBaseUrl: string,
  ollamaEmbedModel: string,
): ToolDefinition {
  return {
    name: "code_search",
    description:
      "Semantic search over the indexed codebase. " +
      "Finds functions, methods, and code sections by meaning, not just keywords. " +
      "Example: 'retry after failure' matches rateLimitBackoff even without those words in the name. " +
      "Requires phase2s sync to have been run. Returns top-K results with file, line range, function name, score, and snippet.",
    parameters: params,
    async execute(raw: unknown): Promise<ToolResult> {
      const { query, k = 3 } = params.parse(raw);

      // Embed the query — generateEmbedding returns [] on any error (no throw)
      let queryVector: number[];
      try {
        queryVector = await generateEmbedding(query, ollamaEmbedModel, ollamaBaseUrl);
      } catch {
        return {
          success: false,
          output: "",
          error:
            "Embedding failed — is Ollama running with the configured model? " +
            `(model: ${ollamaEmbedModel})`,
        };
      }
      if (queryVector.length === 0) {
        return {
          success: false,
          output: "",
          error:
            "Embedding failed — is Ollama running with the configured model? " +
            `(model: ${ollamaEmbedModel})`,
        };
      }

      // Run semantic search + staleness check concurrently.
      // searchCode handles index loading, path traversal guard, snippet extraction.
      const [results, staleness] = await Promise.all([
        searchCode(cwd, queryVector, ollamaEmbedModel, ollamaBaseUrl, k),
        checkIndexStaleness(cwd).catch(() => ({ stale: false as const })),
      ]);

      const parts: string[] = [];

      // Non-blocking staleness note
      if (staleness.stale) {
        parts.push(
          `⚠ Index may be stale (${staleness.newestFile} is newer than the index). ` +
          `Run 'phase2s sync' to refresh.`,
        );
      }

      if (results.length === 0) {
        parts.push("No results found. Has `phase2s sync` been run?");
        return { success: true, output: parts.join("\n") };
      }

      // Format results — snippet already extracted by searchCode()
      const formatted = results.map((r, i) => {
        // Only show line range when chunk boundaries are known; whole-file entries
        // have no meaningful range — showing ":0–?" would mislead the agent.
        const range = r.chunkStart != null ? `:${r.chunkStart}–${r.chunkEnd ?? "?"}` : "";
        return (
          `[${i + 1}] ${r.path}${range}` +
          (r.chunkName ? `\nFunction: ${r.chunkName}` : "") +
          `\nScore: ${r.score.toFixed(3)}` +
          (r.snippet ? `\n\`\`\`\n${r.snippet}\n\`\`\`` : "")
        );
      });

      parts.push(...formatted);
      return { success: true, output: parts.join("\n\n") };
    },
  };
}
