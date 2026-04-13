/**
 * --sandbox flag implementation.
 *
 * Creates an isolated git worktree for experimental sessions. The REPL starts
 * inside the worktree so all file writes, sessions, and state are isolated from
 * the main project tree. On exit, the user is prompted to merge back or preserve.
 *
 * Branch naming: sandbox/<slugified-name>
 * Worktree path: <projectCwd>/.worktrees/sandbox-<slugified-name>
 */

import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { loadConfig } from "../core/config.js";
import type { Config } from "../core/config.js";
import { interactiveMode } from "./index.js";

// ---------------------------------------------------------------------------
// Slug helpers
// ---------------------------------------------------------------------------

/**
 * Convert a free-form name into a URL/branch-safe slug.
 *
 * Rules:
 * - Lowercase
 * - Non-alphanumeric characters → hyphen
 * - Consecutive hyphens collapsed to one
 * - Leading/trailing hyphens stripped
 * - Max 40 characters (truncated at character boundary)
 *
 * Examples:
 *   "spike new provider" → "spike-new-provider"
 *   "Feature/OAuth2!"   → "feature-oauth2"
 *   "foo--bar"          → "foo-bar"
 *   "-foo-"             → "foo"
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

/**
 * Return the list of worktree paths currently registered with git.
 * Parses `git worktree list --porcelain` output.
 */
function listWorktreePaths(cwd: string): string[] {
  try {
    const out = execSync("git worktree list --porcelain", { cwd, encoding: "utf8", stdio: "pipe" });
    return out
      .split("\n")
      .filter((l) => l.startsWith("worktree "))
      .map((l) => l.slice("worktree ".length).trim());
  } catch {
    return [];
  }
}

/**
 * Return the current branch name. Returns empty string in detached HEAD.
 */
function currentBranch(cwd: string): string {
  try {
    return execSync("git branch --show-current", { cwd, encoding: "utf8", stdio: "pipe" }).trim();
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Start (or resume) a sandbox session.
 *
 * @param name            Raw name from the CLI (e.g. "spike new provider")
 * @param projectCwd      Project root (already resolved by -C preAction if present)
 * @param configOverrides CLI opts to forward to loadConfig (provider, model, systemPrompt)
 */
export async function startSandbox(
  name: string,
  projectCwd: string,
  configOverrides: Partial<Config> = {},
): Promise<void> {
  // -------------------------------------------------------------------------
  // 1. Slugify and derive names
  // -------------------------------------------------------------------------
  const slugName = slugify(name);
  if (!slugName) {
    console.error(`Error: Sandbox name "${name}" contains no valid alphanumeric characters.`);
    console.error("Use a name with letters or numbers (e.g. phase2s --sandbox my-experiment)");
    process.exit(1);
  }

  const slug = `sandbox-${slugName}`;
  const branchName = `sandbox/${slugName}`;
  const worktreePath = join(projectCwd, ".worktrees", slug);

  // -------------------------------------------------------------------------
  // 2. Capture original context
  // -------------------------------------------------------------------------
  const originalCwd = projectCwd;
  const originalBranch = currentBranch(projectCwd);

  if (!originalBranch) {
    console.error("Error: Cannot start sandbox in detached HEAD state.");
    console.error("Checkout a branch first: git checkout -b my-branch");
    process.exit(1);
  }

  // -------------------------------------------------------------------------
  // 3. Detect and handle existing worktree state
  // -------------------------------------------------------------------------
  const registeredPaths = listWorktreePaths(projectCwd);
  const inGit = registeredPaths.includes(worktreePath);
  const dirExists = existsSync(worktreePath);

  if (inGit && dirExists) {
    // State (a): already exists and is healthy — resume
    console.log(`Resuming sandbox '${name}' at ${worktreePath}`);
  } else if (inGit && !dirExists) {
    // State (b): git knows about it but directory was deleted (e.g. manual rm)
    // Prune stale git entry, then recreate using existing branch (no -b)
    console.log(`Pruning stale worktree entry for sandbox '${name}'...`);
    execSync("git worktree prune", { cwd: projectCwd, encoding: "utf8", stdio: "pipe" });
    try {
      execSync(
        `git worktree add "${worktreePath}" ${branchName}`,
        { cwd: projectCwd, encoding: "utf8", stdio: "pipe" },
      );
    } catch (err) {
      console.error(`Failed to create sandbox: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  } else if (!inGit && dirExists) {
    // State (c): directory exists but git doesn't know about it (leftover from crash)
    // Remove the orphaned directory and recreate fresh
    console.log(`Removing orphaned worktree directory for sandbox '${name}'...`);
    rmSync(worktreePath, { recursive: true });
    try {
      execSync(
        `git worktree add -b "${branchName}" "${worktreePath}" HEAD`,
        { cwd: projectCwd, encoding: "utf8", stdio: "pipe" },
      );
    } catch (err) {
      console.error(`Failed to create sandbox: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  } else {
    // State (d): fresh — no git entry, no directory
    try {
      execSync(
        `git worktree add -b "${branchName}" "${worktreePath}" HEAD`,
        { cwd: projectCwd, encoding: "utf8", stdio: "pipe" },
      );
    } catch (err) {
      console.error(`Failed to create sandbox: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
    console.log(`Created sandbox '${name}' on branch ${branchName}`);
  }

  // -------------------------------------------------------------------------
  // 4. Start the REPL inside the worktree
  // -------------------------------------------------------------------------
  process.chdir(worktreePath);

  // loadConfig() reads from process.cwd() (now worktreePath). Config overrides
  // from CLI opts (provider, model, system) are forwarded so they're not lost.
  const config = await loadConfig(configOverrides);

  try {
    await interactiveMode(config);
  } catch {
    // interactiveMode should resolve after the SIGINT refactor, but guard against
    // edge-case rejections (e.g. uncaught errors mid-session). Either way, we
    // still want to run the merge prompt so the user's work is never silently lost.
  } finally {
    // -------------------------------------------------------------------------
    // 5. On REPL exit — chdir back FIRST (before any git operations that might
    //    remove the worktree directory we're standing in), then prompt for merge.
    // -------------------------------------------------------------------------
    process.chdir(originalCwd);

    console.log(`\nSandbox '${name}' ended.`);
    await promptMergeBack(name, slugName, branchName, worktreePath, originalBranch, originalCwd);
  }
}

// ---------------------------------------------------------------------------
// Merge-back prompt
// ---------------------------------------------------------------------------

async function promptMergeBack(
  name: string,
  slugName: string,
  branchName: string,
  worktreePath: string,
  originalBranch: string,
  originalCwd: string,
): Promise<void> {
  const answer = await askLine(`Merge sandbox back into '${originalBranch}'? [y/N] `);
  const wantsYes = answer.trim().toLowerCase() === "y";

  if (wantsYes) {
    try {
      execSync(
        `git merge --no-ff ${branchName} -m "sandbox: merge ${slugName}"`,
        { cwd: originalCwd, encoding: "utf8", stdio: "pipe" },
      );
      // Clean up: remove worktree + branch
      try {
        execSync(`git worktree remove --force "${worktreePath}"`, { cwd: originalCwd, encoding: "utf8", stdio: "pipe" });
      } catch { /* ignore — directory may be already gone */ }
      try {
        execSync(`git branch -D ${branchName}`, { cwd: originalCwd, encoding: "utf8", stdio: "pipe" });
      } catch { /* ignore — branch deletion failure is non-fatal */ }
      console.log(`Sandbox '${name}' merged into '${originalBranch}' and cleaned up.`);
    } catch {
      // Merge conflict or other failure — preserve worktree
      console.log(`\nMerge conflicts — your working tree has unresolved files.`);
      console.log(`To abort:   git merge --abort`);
      console.log(`To resolve: fix conflicts, git add, git commit`);
      console.log(`Worktree preserved at .worktrees/sandbox-${slugName}`);
    }
  } else {
    console.log(`Sandbox preserved. Resume with: phase2s --sandbox ${name}`);
  }
}

// ---------------------------------------------------------------------------
// Readline helper
// ---------------------------------------------------------------------------

/**
 * Read a single line from stdin with a prompt. Returns the raw line.
 */
function askLine(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}
