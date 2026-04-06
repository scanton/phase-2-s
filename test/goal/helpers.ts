/**
 * Shared test harness for integration tests that need real git repos.
 *
 * Provides utilities to create temp git repos, commit files, and set up
 * merge conflict scenarios for testing parallel executor infrastructure.
 */

import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TempRepo {
  cwd: string;
  cleanup: () => void;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a real temporary git repository.
 *
 * Runs git init, sets user.email/user.name (required for CI where global
 * git config may be absent), and makes an initial commit.
 *
 * @returns { cwd, cleanup } — call cleanup() in finally block.
 */
export function makeTempRepo(): TempRepo {
  const cwd = mkdtempSync(join(tmpdir(), "phase2s-test-"));

  execSync("git init", { cwd, stdio: "pipe" });
  execSync('git config user.email "test@phase2s.test"', { cwd, stdio: "pipe" });
  execSync('git config user.name "Phase2S Test"', { cwd, stdio: "pipe" });

  // Initial commit (required so HEAD exists)
  writeFileSync(join(cwd, ".gitkeep"), "");
  execSync("git add -A", { cwd, stdio: "pipe" });
  execSync('git commit -m "initial commit"', { cwd, stdio: "pipe" });

  const cleanup = () => {
    try {
      rmSync(cwd, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors — don't swallow original test error
    }
  };

  return { cwd, cleanup };
}

/**
 * Write a file to the repo and commit it.
 *
 * @param cwd      Repo directory.
 * @param filename File name (relative to cwd).
 * @param content  File content.
 * @param message  Commit message (defaults to "add <filename>").
 */
export function commitFile(
  cwd: string,
  filename: string,
  content: string,
  message?: string,
): void {
  writeFileSync(join(cwd, filename), content);
  execSync("git add -A", { cwd, stdio: "pipe" });
  execSync(`git commit -m "${message ?? `add ${filename}`}"`, { cwd, stdio: "pipe" });
}

/**
 * Create `count` files with long names and commit them all in one shot.
 *
 * Used to generate git diff stat output > 4096 bytes (requires ~80 files).
 *
 * @param cwd        Repo directory.
 * @param count      Number of files to create.
 * @param namePrefix File name prefix (default "file").
 */
export function commitManyFiles(cwd: string, count: number, namePrefix = "file"): void {
  for (let i = 0; i < count; i++) {
    const name = `${namePrefix}-${"x".repeat(40)}-${i}.ts`;
    writeFileSync(join(cwd, name), `export const v${i} = ${i};\n`);
  }
  execSync(`git add -A && git commit -m 'add ${count} files'`, { cwd, shell: "/bin/sh" });
}

/**
 * Create two branches (branch-a, branch-b) that both modify the same file
 * with different content, creating a merge conflict scenario.
 *
 * Starting from main/master, creates:
 *   - branch-a: modifies filename with "content-a"
 *   - branch-b: modifies filename with "content-b"
 * Then checks out the default branch (main/master).
 *
 * @param cwd      Repo directory.
 * @param filename File to create the conflict on.
 */
export function makeConflictingBranches(cwd: string, filename: string): void {
  const defaultBranch = getDefaultBranch(cwd);

  // branch-a: modify file with content-a
  execSync(`git checkout -b branch-a`, { cwd, stdio: "pipe" });
  writeFileSync(join(cwd, filename), "content-a\n");
  execSync("git add -A", { cwd, stdio: "pipe" });
  execSync('git commit -m "branch-a changes"', { cwd, stdio: "pipe" });

  // branch-b: go back to default, then modify same file with content-b
  execSync(`git checkout ${defaultBranch}`, { cwd, stdio: "pipe" });
  execSync(`git checkout -b branch-b`, { cwd, stdio: "pipe" });
  writeFileSync(join(cwd, filename), "content-b\n");
  execSync("git add -A", { cwd, stdio: "pipe" });
  execSync('git commit -m "branch-b changes"', { cwd, stdio: "pipe" });

  // Return to default branch
  execSync(`git checkout ${defaultBranch}`, { cwd, stdio: "pipe" });
}

/**
 * Create a temp repo, run fn with it, and guarantee cleanup in finally.
 *
 * Cleanup errors are swallowed so the original test error is not masked.
 *
 * @param fn Async or sync test body receiving the repo cwd.
 */
export async function withTempRepo(
  fn: (cwd: string) => void | Promise<void>,
): Promise<void> {
  const { cwd, cleanup } = makeTempRepo();
  try {
    await fn(cwd);
  } finally {
    cleanup();
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getDefaultBranch(cwd: string): string {
  try {
    return execSync("git symbolic-ref --short HEAD", { cwd, encoding: "utf8" }).trim();
  } catch {
    return "master";
  }
}
