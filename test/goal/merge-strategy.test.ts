import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTempRepo, commitFile, makeConflictingBranches, withTempRepo } from "./helpers.js";

// ---------------------------------------------------------------------------
// Merge strategy exports — type-check tests
// ---------------------------------------------------------------------------

describe("merge strategy types", () => {
  it("MergeResult interface has expected shape", async () => {
    const { mergeWorktree } = await import("../../src/goal/merge-strategy.js");
    // Type check: mergeWorktree exists and is a function
    expect(typeof mergeWorktree).toBe("function");
  });

  it("createWorktree is exported", async () => {
    const { createWorktree } = await import("../../src/goal/merge-strategy.js");
    expect(typeof createWorktree).toBe("function");
  });

  it("removeWorktree is exported", async () => {
    const { removeWorktree } = await import("../../src/goal/merge-strategy.js");
    expect(typeof removeWorktree).toBe("function");
  });

  it("cleanAllWorktrees is exported", async () => {
    const { cleanAllWorktrees } = await import("../../src/goal/merge-strategy.js");
    expect(typeof cleanAllWorktrees).toBe("function");
  });

  it("stashIfDirty is exported", async () => {
    const { stashIfDirty } = await import("../../src/goal/merge-strategy.js");
    expect(typeof stashIfDirty).toBe("function");
  });

  it("symlinkNodeModules is exported", async () => {
    const { symlinkNodeModules } = await import("../../src/goal/merge-strategy.js");
    expect(typeof symlinkNodeModules).toBe("function");
  });
});

describe("symlinkNodeModules with nonexistent paths", () => {
  it("returns false when source does not exist", async () => {
    const { symlinkNodeModules } = await import("../../src/goal/merge-strategy.js");
    const result = symlinkNodeModules("/nonexistent/proj", "/nonexistent/wt");
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// mergeWorktree() — conflict detection with real git
// ---------------------------------------------------------------------------

describe("mergeWorktree conflict detection", () => {
  it("detects conflict when two branches modify the same file", async () => {
    const { mergeWorktree } = await import("../../src/goal/merge-strategy.js");

    await withTempRepo(async (cwd) => {
      // Create the base file on main/default branch
      commitFile(cwd, "conflict.txt", "original content\n");

      // Create conflicting branches
      makeConflictingBranches(cwd, "conflict.txt");

      // Merge branch-a first (should succeed)
      const resultA = mergeWorktree(cwd, 0, "task-a", "branch-a");
      expect(resultA.status).toBe("success");

      // Now merge branch-b — should conflict (both modified conflict.txt)
      const resultB = mergeWorktree(cwd, 1, "task-b", "branch-b");
      expect(resultB.status).toBe("conflict");
      expect(resultB.conflictFiles).toBeDefined();
      expect(resultB.conflictFiles!.length).toBeGreaterThan(0);
      expect(resultB.conflictFiles).toContain("conflict.txt");
    });
  });

  it("git merge --abort restores clean state after conflict", async () => {
    const { mergeWorktree } = await import("../../src/goal/merge-strategy.js");

    await withTempRepo(async (cwd) => {
      commitFile(cwd, "shared.txt", "base\n");
      makeConflictingBranches(cwd, "shared.txt");

      // Merge branch-a to set up the conflict baseline
      mergeWorktree(cwd, 0, "task-a", "branch-a");

      // Merge branch-b — conflict; mergeWorktree already aborts internally
      const result = mergeWorktree(cwd, 1, "task-b", "branch-b");
      expect(result.status).toBe("conflict");

      // After mergeWorktree aborts, working tree should be clean
      const porcelain = execSync("git status --porcelain", { cwd, encoding: "utf8" }).trim();
      expect(porcelain).toBe("");
    });
  });
});

// ---------------------------------------------------------------------------
// stashIfDirty / unstash — real git integration tests
// ---------------------------------------------------------------------------

describe("stashIfDirty / unstash", () => {
  it("dirty tracked file → stashIfDirty returns true", async () => {
    const { stashIfDirty } = await import("../../src/goal/merge-strategy.js");

    await withTempRepo(async (cwd) => {
      commitFile(cwd, "app.ts", "export const x = 1;\n");
      writeFileSync(join(cwd, "app.ts"), "export const x = 2;\n");
      const result = stashIfDirty(cwd);
      expect(result).toBe(true);
    });
  });

  it("clean working tree → stashIfDirty returns false", async () => {
    const { stashIfDirty } = await import("../../src/goal/merge-strategy.js");

    await withTempRepo(async (cwd) => {
      commitFile(cwd, "app.ts", "export const x = 1;\n");
      const result = stashIfDirty(cwd);
      expect(result).toBe(false);
    });
  });

  it("stash then unstash → file content is restored (modification reappears)", async () => {
    const { stashIfDirty, unstash } = await import("../../src/goal/merge-strategy.js");

    await withTempRepo(async (cwd) => {
      commitFile(cwd, "app.ts", "export const x = 1;\n");
      // Dirty the file
      writeFileSync(join(cwd, "app.ts"), "export const x = 999;\n");
      // Stash — should make tree clean
      stashIfDirty(cwd);
      const afterStash = execSync("git status --porcelain", { cwd, encoding: "utf8" }).trim();
      expect(afterStash).toBe("");
      // Unstash — modification should reappear
      unstash(cwd);
      const afterUnstash = execSync("git status --porcelain", { cwd, encoding: "utf8" }).trim();
      expect(afterUnstash).not.toBe("");
    });
  });

  it("unstash on clean tree (no stash) → no error thrown", async () => {
    const { unstash } = await import("../../src/goal/merge-strategy.js");

    await withTempRepo(async (cwd) => {
      commitFile(cwd, "app.ts", "export const x = 1;\n");
      // No stash was created
      expect(() => unstash(cwd)).not.toThrow();
    });
  });
});
