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
    .replace(/[^a-z0-9]+/g, "-")  // collapses runs of non-alphanumeric chars → single hyphen
    .slice(0, 40)                  // truncate first, then strip — prevents trailing hyphen after cut
    .replace(/^-+|-+$/g, "");
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

/**
 * Represents a single worktree entry from `git worktree list --porcelain`.
 */
interface WorktreeEntry {
  path: string;
  commit: string;
  branch: string; // full ref, e.g. "refs/heads/sandbox/foo". Empty string for detached HEAD.
}

/**
 * Parse `git worktree list --porcelain` output into structured entries.
 * Throws if the git command fails (caller decides how to handle).
 * Each worktree block is separated by a blank line.
 */
function parseWorktreePorcelain(cwd: string): WorktreeEntry[] {
  const out = execSync("git worktree list --porcelain", { cwd, encoding: "utf8", stdio: "pipe" });
  const entries: WorktreeEntry[] = [];
  // Blocks are separated by blank lines
  for (const block of out.split(/\n\n+/)) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    const pathLine = lines.find((l) => l.startsWith("worktree "));
    const headLine = lines.find((l) => l.startsWith("HEAD "));
    const branchLine = lines.find((l) => l.startsWith("branch "));
    if (!pathLine) continue;
    entries.push({
      path: pathLine.slice("worktree ".length),
      commit: headLine ? headLine.slice("HEAD ".length) : "",
      branch: branchLine ? branchLine.slice("branch ".length) : "",
    });
  }
  return entries;
}

/**
 * Return the list of worktree paths currently registered with git.
 *
 * Returns [] only when git is not installed (ENOENT). Any other error (e.g.
 * git lock, permission denied, non-zero exit) is rethrown — swallowing those
 * would misclassify a healthy registered worktree as "not in git" and could
 * cause the state machine to delete and recreate it unnecessarily.
 *
 * Asymmetry with listSandboxes: listSandboxes calls parseWorktreePorcelain
 * directly and intentionally throws on ALL errors (the list command should fail
 * loudly if git is broken). Only listWorktreePaths needs the ENOENT carve-out
 * because it's used for worktree existence checks where "no git" = "no worktrees".
 *
 * @internal — exported for testability only.
 */
export function listWorktreePaths(cwd: string): string[] {
  try {
    return parseWorktreePorcelain(cwd).map((e) => e.path);
  } catch (err: unknown) {
    // Only swallow ENOENT (cwd does not exist — string-form execSync throws
    // ENOENT when the working directory is missing, NOT when git is absent).
    // Any other error means git IS available but something went wrong — rethrow
    // so callers fail loudly.
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }
}

/**
 * Sandbox entry for display in `phase2s sandboxes`.
 */
export interface SandboxEntry {
  name: string;   // slug only, e.g. "spike-foo"
  path: string;   // absolute worktree path
  commit: string; // short commit hash (7 chars)
}

/**
 * List all active sandbox worktrees for the given repo root.
 * Throws if git is unavailable or cwd is not a git repo.
 */
export function listSandboxes(cwd: string): SandboxEntry[] {
  const entries = parseWorktreePorcelain(cwd);
  return entries
    .filter((e) => e.branch.startsWith("refs/heads/sandbox/"))
    .map((e) => ({
      name: e.branch.slice("refs/heads/sandbox/".length),
      path: e.path,
      commit: e.commit.slice(0, 7),
    }));
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
 *
 * Dirty working tree note: staged or unstaged changes in the main worktree do NOT
 * block `git worktree add` and do NOT propagate to the sandbox. The sandbox starts
 * from HEAD — your uncommitted changes stay in the main worktree, isolated from the
 * sandbox. No auto-stash is needed. (Verified: 2026-04-13, git 2.44+)
 */
export async function startSandbox(
  name: string,
  projectCwd: string,
  configOverrides: Partial<Config> = {},
  resume = false,
): Promise<void> {
  // -------------------------------------------------------------------------
  // 0. Pre-flight: verify we're inside a git repository.
  //    currentBranch() silently swallows non-git errors and returns "", which
  //    produces a misleading "detached HEAD" message. Check explicitly first.
  // -------------------------------------------------------------------------
  try {
    execSync("git rev-parse --is-inside-work-tree", {
      cwd: projectCwd,
      stdio: "pipe",
      encoding: "utf8",
    });
  } catch (err: unknown) {
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT") {
      console.error("Error: phase2s --sandbox requires an existing directory.");
      console.error(`'${projectCwd}' does not exist.`);
    } else {
      console.error("Error: phase2s --sandbox requires a git repository.");
      console.error(`'${projectCwd}' is not inside a git repository.`);
      console.error("Run 'git init' to create one, or cd into an existing repo.");
    }
    process.exit(1);
  }

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
        `git worktree add "${worktreePath}" "${branchName}"`,
        { cwd: projectCwd, encoding: "utf8", stdio: "pipe" },
      );
    } catch (err) {
      console.error(`Failed to create sandbox: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  } else if (!inGit && dirExists) {
    // State (c): directory exists but git doesn't know about it (leftover from crash).
    // Remove the orphaned directory, then recreate — but check if the branch already
    // exists in git first. If it does (e.g. crash happened after branch creation but
    // before worktree registration), use the existing branch (no -b). Using -b on an
    // existing branch would fail and leave the user with a deleted directory and no worktree.
    console.log(`Removing orphaned worktree directory for sandbox '${name}'...`);
    const branchAlreadyExists = (() => {
      try {
        return execSync(
          `git branch --list "${branchName}"`,
          { cwd: projectCwd, encoding: "utf8", stdio: "pipe" },
        ).trim().length > 0;
      } catch {
        return false;
      }
    })();
    rmSync(worktreePath, { recursive: true });
    try {
      if (branchAlreadyExists) {
        execSync(
          `git worktree add "${worktreePath}" "${branchName}"`,
          { cwd: projectCwd, encoding: "utf8", stdio: "pipe" },
        );
      } else {
        execSync(
          `git worktree add -b "${branchName}" "${worktreePath}" HEAD`,
          { cwd: projectCwd, encoding: "utf8", stdio: "pipe" },
        );
      }
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
    await interactiveMode(config, { resume });
  } catch {
    // interactiveMode should resolve after the SIGINT refactor, but guard against
    // edge-case rejections (e.g. uncaught errors mid-session). Either way, we
    // still want to run the merge prompt so the user's work is never silently lost.
  } finally {
    // -------------------------------------------------------------------------
    // 5. On REPL exit — chdir back FIRST (before any git operations that might
    //    remove the worktree directory we're standing in), then prompt for merge.
    // -------------------------------------------------------------------------
    process.chdir(projectCwd);

    console.log(`\nSandbox '${name}' ended.`);
    await promptMergeBack(name, slugName, branchName, worktreePath, originalBranch, projectCwd);
  }
}

// ---------------------------------------------------------------------------
// Merge-back prompt
// ---------------------------------------------------------------------------

/**
 * Return true if the worktree has uncommitted changes (staged or unstaged).
 * Returns false on any error (conservative: assume clean rather than blocking).
 */
function hasUncommittedChanges(worktreePath: string): boolean {
  try {
    const out = execSync("git status --porcelain", {
      cwd: worktreePath,
      encoding: "utf8",
      stdio: "pipe",
    });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

async function promptMergeBack(
  name: string,
  slugName: string,
  branchName: string,
  worktreePath: string,
  originalBranch: string,
  projectCwd: string,
): Promise<void> {
  const answer = await askLine(`Merge sandbox back into '${originalBranch}'? [y/N] `);
  const wantsYes = answer.trim().toLowerCase() === "y";

  if (wantsYes) {
    // Warn before cleanup if the sandbox has uncommitted work that would be lost
    // when we run `git worktree remove --force` after a successful merge.
    if (hasUncommittedChanges(worktreePath)) {
      console.log(`\nWarning: sandbox '${name}' has uncommitted changes.`);
      console.log(`These will be permanently lost after merge cleanup.`);
      const confirm = await askLine(`Proceed anyway and discard uncommitted work? [y/N] `);
      if (confirm.trim().toLowerCase() !== "y") {
        console.log(`Merge cancelled. Commit or stash your changes first, then re-run phase2s --sandbox ${name}.`);
        return;
      }
    }

    // Separate try blocks so checkout failure (branch deleted externally) is not
    // misdiagnosed as a merge conflict.
    try {
      // Explicitly checkout the original branch before merging — guards against the case
      // where the user checked out a different branch externally during the sandbox session.
      execSync(`git checkout "${originalBranch}"`, { cwd: projectCwd, encoding: "utf8", stdio: "pipe" });
    } catch (checkoutErr) {
      console.log(`\nCould not return to branch '${originalBranch}'. It may have been deleted or renamed.`);
      console.log(`Error: ${checkoutErr instanceof Error ? checkoutErr.message : String(checkoutErr)}`);
      console.log(`Sandbox branch '${branchName}' and worktree preserved at ${worktreePath}`);
      return;
    }

    try {
      execSync(
        `git merge --no-ff "${branchName}" -m "sandbox: merge ${slugName}"`,
        { cwd: projectCwd, encoding: "utf8", stdio: "pipe" },
      );
      // Clean up: remove worktree + branch
      try {
        execSync(`git worktree remove --force "${worktreePath}"`, { cwd: projectCwd, encoding: "utf8", stdio: "pipe" });
      } catch { /* ignore — directory may be already gone */ }
      try {
        execSync(`git branch -D "${branchName}"`, { cwd: projectCwd, encoding: "utf8", stdio: "pipe" });
      } catch { /* ignore — branch deletion failure is non-fatal */ }
      console.log(`Sandbox '${name}' merged into '${originalBranch}' and cleaned up.`);
    } catch {
      // Merge conflict — preserve worktree.
      // Note: the merge ran in the main repo (projectCwd), not in the sandbox worktree.
      // Conflicts must be resolved there, not in the sandbox worktree.
      console.log(`\nMerge failed. Conflicts are in your main repo, not the sandbox worktree.`);
      console.log(`To abort the merge:  cd ${projectCwd} && git merge --abort`);
      console.log(`To resolve manually: cd ${projectCwd}, fix conflicts, git add, git commit`);
      console.log(`Sandbox branch '${branchName}' and worktree preserved for reference.`);
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
