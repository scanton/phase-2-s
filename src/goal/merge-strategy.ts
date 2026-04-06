/**
 * Merge strategy for parallel dark factory workers.
 *
 * After all workers in a level complete, their worktree branches are merged
 * into the main working tree sequentially in spec order. Same-file conflicts
 * halt the pipeline immediately.
 *
 * No auto-resolve in v1.12.0. LLM-powered merge resolution is deferred.
 */

import { execSync } from "node:child_process";
import { existsSync, symlinkSync } from "node:fs";
import { resolve, join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MergeResult {
  index: number;
  subtaskName: string;
  status: "success" | "conflict" | "error";
  conflictFiles?: string[];
  error?: string;
}

export interface LevelMergeResult {
  level: number;
  results: MergeResult[];
  /** True if all merges succeeded. */
  success: boolean;
  /** Duration of the merge phase in milliseconds. */
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Merge all completed worktrees for a level into the main branch.
 *
 * Merges are performed sequentially in the order provided (spec order).
 * Halts on first same-file conflict.
 *
 * @param cwd           Project root directory.
 * @param workerResults Array of { index, subtaskName, worktreeBranch } for completed workers.
 * @returns Merge results for each worker.
 */
export function mergeLevel(
  cwd: string,
  workerResults: Array<{ index: number; subtaskName: string; worktreeBranch: string }>,
  levelNum: number = 0,
): LevelMergeResult {
  const start = Date.now();
  const results: MergeResult[] = [];
  let allSuccess = true;

  for (const worker of workerResults) {
    const result = mergeWorktree(cwd, worker.index, worker.subtaskName, worker.worktreeBranch);
    results.push(result);

    if (result.status !== "success") {
      allSuccess = false;
      break; // Halt on first conflict or error
    }
  }

  return {
    level: levelNum,
    results,
    success: allSuccess,
    durationMs: Date.now() - start,
  };
}

/**
 * Merge a single worktree branch into the current branch.
 */
export function mergeWorktree(
  cwd: string,
  index: number,
  subtaskName: string,
  worktreeBranch: string,
): MergeResult {
  try {
    // Check if branch exists
    try {
      execSync(`git rev-parse --verify ${worktreeBranch}`, { cwd, encoding: "utf8", stdio: "pipe" });
    } catch {
      return { index, subtaskName, status: "error", error: `Branch ${worktreeBranch} does not exist (stale worktree?)` };
    }

    // Attempt merge
    const safeSubtask = subtaskName.replace(/"/g, '\\"');
    execSync(`git merge --no-ff ${worktreeBranch} -m "parallel: merge ${safeSubtask}"`, {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
    });

    return { index, subtaskName, status: "success" };
  } catch (err: unknown) {
    // Check if this is a merge conflict
    const conflictFiles = detectConflictFiles(cwd);
    if (conflictFiles.length > 0) {
      // Abort the failed merge to restore clean state
      try {
        execSync("git merge --abort", { cwd, stdio: "pipe" });
      } catch {
        // merge --abort can fail if there was no merge in progress
      }
      return { index, subtaskName, status: "conflict", conflictFiles };
    }

    // Some other git error
    const message = err instanceof Error ? err.message : String(err);
    return { index, subtaskName, status: "error", error: message };
  }
}

// ---------------------------------------------------------------------------
// Worktree management helpers
// ---------------------------------------------------------------------------

/**
 * Create a git worktree for a parallel worker.
 *
 * @param cwd       Project root directory.
 * @param slug      Worktree slug (e.g., "auth-module-abc123").
 * @param baseRef   Git ref to base the worktree on (usually HEAD).
 * @returns Object with worktreePath and branchName, or error.
 */
export function createWorktree(
  cwd: string,
  slug: string,
  baseRef: string = "HEAD",
): { worktreePath: string; branchName: string } | { error: string } {
  const worktreePath = `${cwd}/.worktrees/${slug}`;
  const branchName = `parallel/${slug}`;

  try {
    execSync(`git worktree add -b ${branchName} "${worktreePath}" ${baseRef}`, {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
    });
    return { worktreePath, branchName };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `Failed to create worktree: ${message}` };
  }
}

/**
 * Remove a git worktree and its branch.
 */
export function removeWorktree(cwd: string, slug: string): void {
  const worktreePath = `${cwd}/.worktrees/${slug}`;
  const branchName = `parallel/${slug}`;

  try {
    execSync(`git worktree remove --force "${worktreePath}"`, { cwd, stdio: "pipe" });
  } catch {
    // Worktree may already be removed
  }

  try {
    execSync(`git branch -D ${branchName}`, { cwd, stdio: "pipe" });
  } catch {
    // Branch may already be deleted
  }
}

/**
 * Remove all parallel worktrees (cleanup).
 */
export function cleanAllWorktrees(cwd: string): void {
  try {
    // List all worktrees
    const output = execSync("git worktree list --porcelain", { cwd, encoding: "utf8" });
    const lines = output.split("\n");
    for (const line of lines) {
      if (line.startsWith("worktree ") && line.includes("/.worktrees/")) {
        const path = line.replace("worktree ", "").trim();
        try {
          execSync(`git worktree remove --force "${path}"`, { cwd, stdio: "pipe" });
        } catch {
          // Ignore individual failures
        }
      }
    }
  } catch {
    // git worktree list failed — nothing to clean
  }

  // Also clean up parallel branches
  try {
    const branches = execSync("git branch --list 'parallel/*'", { cwd, encoding: "utf8" });
    for (const branch of branches.split("\n")) {
      const name = branch.trim().replace(/^\*\s*/, "");
      if (name.startsWith("parallel/")) {
        try {
          execSync(`git branch -D ${name}`, { cwd, stdio: "pipe" });
        } catch {
          // Ignore
        }
      }
    }
  } catch {
    // No parallel branches
  }
}

/**
 * Symlink node_modules from the base tree into a worktree.
 */
export function symlinkNodeModules(cwd: string, worktreePath: string): boolean {
  try {
    const source = resolve(cwd, "node_modules");
    const target = join(worktreePath, "node_modules");

    if (!existsSync(source)) return false;
    if (existsSync(target)) return true; // Already exists

    symlinkSync(source, target, "junction"); // "junction" works on Windows too
    return true;
  } catch {
    return false;
  }
}

/**
 * Stash uncommitted changes if the working tree is dirty.
 * Uses a named stash "phase2s-<runId>" to avoid index-based ambiguity.
 * Returns true if a stash was created.
 */
export function stashIfDirty(cwd: string, runId: string): boolean {
  try {
    const status = execSync("git status --porcelain", { cwd, encoding: "utf8" }).trim();
    if (!status) return false;

    execSync(`git stash push --message "phase2s-${runId}"`, { cwd, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Pop the Phase2S stash created by stashIfDirty.
 * Finds the entry by name and pops it by ref — safe even if the user
 * has pre-existing stash entries at lower indices.
 */
export function unstash(cwd: string, runId: string): void {
  try {
    const target = `phase2s-${runId}`;
    const list = execSync('git stash list --format="%gd %s"', { cwd, encoding: "utf8" });
    for (const line of list.trim().split("\n")) {
      if (line.includes(target)) {
        // line format: "stash@{N} On branch: phase2s-<runId>" or similar
        const ref = line.split(" ")[0]; // e.g. stash@{1}
        execSync(`git stash pop ${ref}`, { cwd, stdio: "pipe" });
        return;
      }
    }
  } catch {
    // Ignore stash errors
  }
}

/**
 * Return the current HEAD commit SHA.
 */
export function getHeadSha(cwd: string): string {
  return execSync("git rev-parse HEAD", { cwd, encoding: "utf8" }).trim();
}

/**
 * Return the git diff between two refs as a string.
 * Returns empty string if the diff command fails (e.g. no commits yet).
 */
export function getDiff(baseRef: string, headRef: string, cwd: string): string {
  try {
    return execSync(`git diff ${baseRef} ${headRef}`, { cwd, encoding: "utf8" });
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function detectConflictFiles(cwd: string): string[] {
  try {
    const output = execSync("git diff --name-only --diff-filter=U", { cwd, encoding: "utf8" });
    return output.trim().split("\n").filter(f => f.trim().length > 0);
  } catch {
    return [];
  }
}
