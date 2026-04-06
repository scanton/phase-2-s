import { describe, it, expect } from "vitest";
import { makeWorktreeSlug } from "../../src/goal/parallel-executor.js";
import { stashIfDirty, unstash } from "../../src/goal/merge-strategy.js";
import { makeTempRepo, commitFile, withTempRepo } from "./helpers.js";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// makeWorktreeSlug — deterministic format tests
// ---------------------------------------------------------------------------

describe("makeWorktreeSlug", () => {
  it("generates deterministic slug from specHash + index", () => {
    expect(makeWorktreeSlug("abc123def456789", 0)).toBe("ph2s-abc123de-0");
  });
  it("uses first 8 chars of specHash", () => {
    expect(makeWorktreeSlug("ffffffff00000000", 3)).toBe("ph2s-ffffffff-3");
  });
  it("same hash + index produces same slug (deterministic)", () => {
    expect(makeWorktreeSlug("abc123def456", 0)).toBe(makeWorktreeSlug("abc123def456", 0));
  });
  it("different indexes produce different slugs", () => {
    expect(makeWorktreeSlug("abc123def456", 0)).not.toBe(makeWorktreeSlug("abc123def456", 1));
  });
  it("different hashes produce different slugs", () => {
    expect(makeWorktreeSlug("aaaa1111", 0)).not.toBe(makeWorktreeSlug("bbbb2222", 0));
  });
});

// ---------------------------------------------------------------------------
// stashIfDirty / unstash — using real temp repos
// ---------------------------------------------------------------------------

describe("stashIfDirty / unstash (parallel-executor suite)", () => {
  it("dirty tracked file → stashIfDirty returns true", async () => {
    await withTempRepo(async (cwd) => {
      // Create a tracked file and commit it
      commitFile(cwd, "app.ts", "export const x = 1;\n");
      // Modify it without committing (dirty tracked file)
      writeFileSync(join(cwd, "app.ts"), "export const x = 2;\n");
      const result = stashIfDirty(cwd);
      expect(result).toBe(true);
    });
  });

  it("clean working tree → stashIfDirty returns false", async () => {
    await withTempRepo(async (cwd) => {
      commitFile(cwd, "app.ts", "export const x = 1;\n");
      // No modifications — clean tree
      const result = stashIfDirty(cwd);
      expect(result).toBe(false);
    });
  });

  it("unstash after stash → file content restored", async () => {
    const { execSync } = await import("node:child_process");
    await withTempRepo(async (cwd) => {
      // Commit the file in its original state
      commitFile(cwd, "app.ts", "export const x = 1;\n");
      // Modify it (dirty)
      writeFileSync(join(cwd, "app.ts"), "export const x = 999;\n");
      // Stash
      stashIfDirty(cwd);
      // After stash, file should be reverted to committed state
      const afterStash = execSync("git status --porcelain", { cwd, encoding: "utf8" }).trim();
      expect(afterStash).toBe("");
      // Unstash — modification should be restored
      unstash(cwd);
      const afterUnstash = execSync("git status --porcelain", { cwd, encoding: "utf8" }).trim();
      expect(afterUnstash).not.toBe("");
    });
  });

  it("unstash on clean tree (no stash) → no error thrown", async () => {
    await withTempRepo(async (cwd) => {
      commitFile(cwd, "app.ts", "export const x = 1;\n");
      // Don't stash anything — tree is clean
      expect(() => unstash(cwd)).not.toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// completedLevels skip on resume
// ---------------------------------------------------------------------------

describe("executeParallel completedLevels", () => {
  it("state with completedLevels: [0] causes level 0 to be skipped", async () => {
    // Verify the executeParallel function properly skips already-completed levels.
    // We test this by importing the module and checking the state logic directly
    // rather than running a full parallel execution (which requires Agent/satori).
    const { executeParallel } = await import("../../src/goal/parallel-executor.js");
    expect(typeof executeParallel).toBe("function");

    // The state check in executeParallel:
    //   if (state.completedLevels?.includes(level.level)) { continue; }
    // We verify this by creating a state with completedLevels: [0] and a
    // depResult with only level 0. With no workers to execute, the level loop
    // body should run 0 times for the skipped level.
    // We use a minimal depResult with 0 subtasks in level 0 to avoid
    // worker spawning, and pre-mark level 0 as completed.
    const depResult = {
      levels: [{ level: 0, subtaskIndices: [] }],
      parallelizable: true,
      totalSubtasks: 0,
    };

    // A minimal GoalState with level 0 completed
    const state = {
      specPath: "/fake/spec.md",
      specHash: "aaaaaaaaaaaaaaaa",
      status: "running" as const,
      completedLevels: [0],
      subTaskResults: {},
      currentLevel: 1,
      startedAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
      attempt: 1,
    };

    const { RunLogger } = await import("../../src/core/run-logger.js");
    const logger = new RunLogger("/tmp", "aaaaaaaaaaaaaaaa");

    // Create a minimal spec
    const spec = {
      title: "test",
      content: "test content",
      decomposition: [],
      constraints: { mustDo: [], cannotDo: [] },
      evalCommand: undefined,
    };

    await withTempRepo(async (cwd) => {
      const origCwd = process.cwd();
      process.chdir(cwd);
      try {
        const result = await executeParallel(depResult, {
          maxWorkers: 1,
          dashboard: false,
          spec,
          specDir: cwd,
          specHash: "aaaaaaaaaaaaaaaa",
          state,
          logger,
          attempt: 1,
          satoriRetries: 0,
        });
        // Level 0 was in completedLevels → skipped → no level results produced
        expect(result.levels).toHaveLength(0);
        // success should be true (no failed levels)
        expect(result.success).toBe(true);
      } finally {
        process.chdir(origCwd);
      }
    });
  });
});
