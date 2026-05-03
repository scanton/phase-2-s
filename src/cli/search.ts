/**
 * phase2s search <query> — semantic search over the indexed codebase.
 *
 * Embeds the query via Ollama, scores all code-index.jsonl entries by
 * cosine similarity, and prints the top-K results with path, score, and
 * a one-line snippet.
 *
 * Requires:
 *   - ollamaBaseUrl configured (phase2s init)
 *   - .phase2s/code-index.jsonl present (phase2s sync)
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import chalk from "chalk";
import { generateEmbedding } from "../core/embeddings.js";
import { readCodeIndex, findTopKCode, extractSnippet, checkIndexStaleness } from "../core/code-index.js";
import type { Config } from "../core/config.js";

const CODE_INDEX_FILE = ".phase2s/code-index.jsonl";
const DEFAULT_K = 5;

export async function runSearch(
  query: string,
  cwd: string,
  config: Config,
  k: number = DEFAULT_K,
): Promise<void> {
  const ollamaBaseUrl = config.ollamaBaseUrl;
  if (!ollamaBaseUrl) {
    console.error(chalk.red("Error: ollamaBaseUrl is not configured."));
    console.error(chalk.dim("Run 'phase2s init' to configure Ollama, then run 'phase2s sync' to build the index."));
    process.exit(1);
  }

  const indexPath = join(cwd, CODE_INDEX_FILE);
  if (!existsSync(indexPath)) {
    console.error(chalk.yellow("No code index found."));
    console.error(chalk.dim("Run 'phase2s sync' first to index your codebase."));
    process.exit(1);
  }

  // Staleness check — dim warning, non-blocking
  const staleness = await checkIndexStaleness(cwd);
  if (staleness.stale) {
    console.log(
      chalk.dim(
        `⚠  Index may be stale (${staleness.newestFile} is newer). Run 'phase2s sync' to refresh.`,
      ),
    );
  }

  const embedModel = config.ollamaEmbedModel ?? "nomic-embed-text:latest";
  const queryVector = await generateEmbedding(query, embedModel, ollamaBaseUrl);

  if (queryVector.length === 0) {
    console.error(chalk.red("Error: could not embed query (Ollama may be down or model not available)."));
    console.error(chalk.dim(`Model: ${embedModel}  Base URL: ${ollamaBaseUrl}`));
    console.error(chalk.dim("Run 'phase2s sync' again once Ollama is available."));
    process.exit(1);
  }

  const index = await readCodeIndex(cwd);
  if (index.length === 0) {
    console.error(chalk.yellow("Code index is empty."));
    console.error(chalk.dim("Run 'phase2s sync' to populate the index."));
    process.exit(1);
  }

  // Model mismatch: if the index was built with a different embed model,
  // vectors are incompatible and all entries will score 0 silently.
  const indexedModel = index[0]?.model;
  if (indexedModel && indexedModel !== embedModel) {
    console.log(
      chalk.yellow(
        `⚠  Index was built with model "${indexedModel}" but current model is "${embedModel}". ` +
        `Run 'phase2s sync' to rebuild with the current model.`,
      ),
    );
  }

  const results = findTopKCode(queryVector, index, k);
  if (results.length === 0) {
    console.log(chalk.dim(`No results for "${query}".`));
    return;
  }

  console.log(chalk.bold(`\nTop ${results.length} matches for "${query}":\n`));

  for (let i = 0; i < results.length; i++) {
    const { path, score } = results[i];

    // Load snippet from file (best-effort — skip if unreadable)
    let snippet = "";
    try {
      const content = await readFile(join(cwd, path), "utf-8");
      snippet = extractSnippet(content);
    } catch {
      // File disappeared since last sync — snippet stays empty
    }

    console.log(`${i + 1}. ${chalk.cyan(path)}  ${chalk.dim(`(${score.toFixed(2)})`)}`);
    if (snippet) {
      console.log(`   ${chalk.dim(snippet)}`);
    }
  }

  console.log();
}
