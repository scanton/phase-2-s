/**
 * Level context injection for parallel workers.
 *
 * Before spawning workers for level N, generates a summary of what prior
 * levels produced. Each worker receives this as additional context in its
 * satori system prompt, compensating for the loss of shared conversation
 * history that sequential execution provides.
 */

import { execSync } from "node:child_process";

/** Max bytes for the level context string injected into worker prompts. */
const MAX_CONTEXT_BYTES = 4096;

/**
 * Build a context summary describing what prior levels changed.
 *
 * @param cwd         Working directory (project root, not worktree).
 * @param baseCommit  The commit hash before parallel execution started.
 * @returns Context string to inject into each worker's prompt, or empty string if no changes.
 */
export function buildLevelContext(cwd: string, baseCommit: string): string {
  try {
    // Get file-level diff stat
    const diffStat = execSync(`git diff --stat ${baseCommit}..HEAD`, {
      cwd,
      encoding: "utf8",
      timeout: 10_000,
    }).trim();

    if (!diffStat) return "";

    // Get list of changed files
    const changedFiles = execSync(`git diff --name-only ${baseCommit}..HEAD`, {
      cwd,
      encoding: "utf8",
      timeout: 10_000,
    }).trim();

    if (!changedFiles) return "";

    const fileList = changedFiles.split("\n").filter(f => f.trim().length > 0);

    let context = "Prior levels modified these files:\n";
    for (const file of fileList) {
      context += `  - ${file}\n`;
    }
    context += `\n${fileList.length} file${fileList.length > 1 ? "s" : ""} changed by prior execution levels.\n`;
    context += "Your subtask should work with these changes already in place.\n";

    // Truncate if too large
    if (Buffer.byteLength(context, "utf8") > MAX_CONTEXT_BYTES) {
      context = context.slice(0, MAX_CONTEXT_BYTES - 50) + "\n... (truncated)\n";
    }

    return context;
  } catch {
    // Git command failed — return empty context rather than blocking the worker
    return "";
  }
}
