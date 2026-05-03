/**
 * phase2s sync — index the current codebase for semantic search.
 *
 * Embeds all indexable source files via Ollama and writes the result to
 * .phase2s/code-index.jsonl. Subsequent runs are incremental: unchanged
 * files (same SHA-256 + same embed model) are skipped.
 *
 * Requires ollamaBaseUrl to be configured (phase2s init).
 */

import chalk from "chalk";
import { generateEmbedding } from "../core/embeddings.js";
import { syncCodebase } from "../core/code-index.js";
import type { Config } from "../core/config.js";

export async function runSync(cwd: string, config: Config): Promise<void> {
  const ollamaBaseUrl = config.ollamaBaseUrl;
  if (!ollamaBaseUrl) {
    console.error(chalk.red("Error: ollamaBaseUrl is not configured."));
    console.error(chalk.dim("Run 'phase2s init' to configure Ollama, then run 'phase2s sync' again."));
    process.exit(1);
  }

  const embedModel = config.ollamaEmbedModel ?? "nomic-embed-text:latest";
  const embedFn = (text: string) => generateEmbedding(text, embedModel, ollamaBaseUrl);

  process.stdout.write(chalk.dim("↺ Scanning codebase...\n"));

  let result;
  try {
    result = await syncCodebase(cwd, embedFn, embedModel);
  } catch (err) {
    console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  }

  const { indexed, skipped, removed } = result;
  console.log(
    chalk.green("✔") +
    ` Indexed ${indexed} ${indexed === 1 ? "file" : "files"}, ` +
    `skipped ${skipped} (unchanged), ` +
    `removed ${removed}`,
  );
  console.log(chalk.dim("  Index: .phase2s/code-index.jsonl"));
}
