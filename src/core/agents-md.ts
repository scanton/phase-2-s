/**
 * AGENTS.md support — discover and load project/user-global instruction files.
 *
 * Discovery order:
 *   1. ~/.phase2s/AGENTS.md — user-global (loaded first, lower precedence)
 *   2. {cwd}/AGENTS.md    — project-level (appended after, higher precedence)
 *
 * Both can coexist. The combined content is injected into the system prompt
 * as a labeled block:
 *
 *   --- AGENTS.md ---
 *   <contents>
 *   --- END AGENTS.md ---
 *
 * Size limit: 8192 chars total. If exceeded, content is truncated and a
 * chalk.yellow warning is printed.
 *
 * Read errors: chalk.yellow warning printed, that file is skipped.
 *
 * Returns null when no content is found (nothing to inject).
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import chalk from "chalk";

const AGENTS_MD_CAP = 8192;

/**
 * Load AGENTS.md content from user-global (~/.phase2s/AGENTS.md) and/or
 * project-level ({cwd}/AGENTS.md). Returns null if nothing is found.
 *
 * @param cwd  Project working directory (process.cwd() in production).
 */
export async function loadAgentsMd(cwd: string): Promise<string | null> {
  const globalPath = join(homedir(), ".phase2s", "AGENTS.md");
  const projectPath = join(cwd, "AGENTS.md");

  const parts: string[] = [];

  // User-global first
  const globalContent = await tryReadFile(globalPath);
  if (globalContent !== null) {
    parts.push(globalContent);
  }

  // Project-level appended after
  const projectContent = await tryReadFile(projectPath);
  if (projectContent !== null) {
    parts.push(projectContent);
  }

  if (parts.length === 0) {
    return null;
  }

  const combined = parts.join("\n\n").trim();
  if (!combined) {
    return null;
  }

  if (combined.length > AGENTS_MD_CAP) {
    const originalKb = Math.ceil(combined.length / 1024);
    const truncated = combined.slice(0, AGENTS_MD_CAP);
    console.warn(
      chalk.yellow(
        `⚠  AGENTS.md truncated to ${Math.round(AGENTS_MD_CAP / 1024)}k chars (was ${originalKb}k). Move rarely-needed content to comments or split into multiple files.`,
      ),
    );
    return truncated;
  }

  return combined;
}

/**
 * Format loaded AGENTS.md content for injection into the system prompt.
 *
 * @param content  Non-null, non-empty AGENTS.md content from loadAgentsMd().
 */
export function formatAgentsMdBlock(content: string): string {
  return `--- AGENTS.md ---\n${content}\n--- END AGENTS.md ---`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read a file, returning its trimmed content or null on any error or if empty.
 */
async function tryReadFile(path: string): Promise<string | null> {
  try {
    const content = await readFile(path, "utf8");
    const trimmed = content.trim();
    return trimmed || null;
  } catch (err: unknown) {
    // ENOENT = file simply doesn't exist — not an error worth reporting
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    console.warn(
      chalk.yellow(`⚠  Could not read AGENTS.md at ${path}: ${(err as Error).message}`),
    );
    return null;
  }
}
