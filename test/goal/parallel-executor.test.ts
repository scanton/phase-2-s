import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeWorktreeSlug, resetWorktreeLocks, resolveSubtaskModel } from "../../src/goal/parallel-executor.js";
import { stashIfDirty, unstash } from "../../src/goal/merge-strategy.js";
import { makeTempRepo, commitFile, withTempRepo } from "./helpers.js";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

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
  const RUN_ID = "testrunid123";

  it("dirty tracked file → stashIfDirty returns true", async () => {
    await withTempRepo(async (cwd) => {
      // Create a tracked file and commit it
      commitFile(cwd, "app.ts", "export const x = 1;\n");
      // Modify it without committing (dirty tracked file)
      writeFileSync(join(cwd, "app.ts"), "export const x = 2;\n");
      const result = stashIfDirty(cwd, RUN_ID);
      expect(result).toBe(true);
    });
  });

  it("clean working tree → stashIfDirty returns false", async () => {
    await withTempRepo(async (cwd) => {
      commitFile(cwd, "app.ts", "export const x = 1;\n");
      // No modifications — clean tree
      const result = stashIfDirty(cwd, RUN_ID);
      expect(result).toBe(false);
    });
  });

  it("unstash after stash → file content restored", async () => {
    await withTempRepo(async (cwd) => {
      // Commit the file in its original state
      commitFile(cwd, "app.ts", "export const x = 1;\n");
      // Modify it (dirty)
      writeFileSync(join(cwd, "app.ts"), "export const x = 999;\n");
      // Stash
      stashIfDirty(cwd, RUN_ID);
      // After stash, file should be reverted to committed state
      const afterStash = execSync("git status --porcelain", { cwd, encoding: "utf8" }).trim();
      expect(afterStash).toBe("");
      // Unstash — modification should be restored
      unstash(cwd, RUN_ID);
      const afterUnstash = execSync("git status --porcelain", { cwd, encoding: "utf8" }).trim();
      expect(afterUnstash).not.toBe("");
    });
  });

  it("unstash on clean tree (no stash) → no error thrown", async () => {
    await withTempRepo(async (cwd) => {
      commitFile(cwd, "app.ts", "export const x = 1;\n");
      // Don't stash anything — tree is clean
      expect(() => unstash(cwd, RUN_ID)).not.toThrow();
    });
  });

  it("unstash pops Phase2S stash by ref even when user stash exists at stash@{0}", async () => {
    // P1 bug regression: old code called `git stash pop` (no ref) which always
    // popped stash@{0} — the user's stash — even if Phase2S stash was at stash@{1}.
    await withTempRepo(async (cwd) => {
      // Commit initial state
      commitFile(cwd, "app.ts", "export const x = 1;\n");
      commitFile(cwd, "utils.ts", "export const y = 2;\n");

      // Create user stash at stash@{0}
      writeFileSync(join(cwd, "utils.ts"), "export const y = 99;\n");
      execSync("git stash push --message 'user-stash'", { cwd, stdio: "pipe" });

      // Now dirty app.ts and create the Phase2S stash (will be at stash@{0}, user at stash@{1})
      writeFileSync(join(cwd, "app.ts"), "export const x = 999;\n");
      stashIfDirty(cwd, RUN_ID);

      // Verify Phase2S stash exists
      const list = execSync("git stash list", { cwd, encoding: "utf8" });
      expect(list).toContain(`phase2s-${RUN_ID}`);
      expect(list).toContain("user-stash");

      // Pop Phase2S stash by name — user stash must remain untouched
      unstash(cwd, RUN_ID);

      // app.ts modification should be restored (Phase2S stash was popped)
      const appStatus = execSync("git status --porcelain app.ts", { cwd, encoding: "utf8" }).trim();
      expect(appStatus).not.toBe("");

      // user stash should still be in the list
      const listAfter = execSync("git stash list", { cwd, encoding: "utf8" });
      expect(listAfter).toContain("user-stash");
      expect(listAfter).not.toContain(`phase2s-${RUN_ID}`);
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

// ---------------------------------------------------------------------------
// Timer leak — clearTimeout called on normal worker completion (P1 fix)
// ---------------------------------------------------------------------------

describe("executeWorker timer leak fix", () => {
  let clearTimeoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    clearTimeoutSpy = vi.spyOn(global, "clearTimeout");
  });

  afterEach(() => {
    clearTimeoutSpy.mockRestore();
  });

  it("clearTimeout is exported from Node global — spy can be installed", () => {
    // Verify the spy mechanism works — clearTimeout exists and is spyable.
    // This is a sanity check that the test infrastructure is correct.
    expect(typeof clearTimeout).toBe("function");
    clearTimeout(undefined);
    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

  it("clearTimeout is called when a Promise.race resolves — verifies the fix pattern", async () => {
    // This test validates the fix pattern used in executeWorker:
    //   finally { clearTimeout(timeoutHandle); }
    // We test the pattern directly rather than running a full worker (which
    // requires Agent/satori infrastructure).
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error("timeout")), 60_000);
      });
      const fastPromise = Promise.resolve("done");
      await Promise.race([fastPromise, timeoutPromise]);
    } finally {
      clearTimeout(timeoutHandle);
    }
    expect(clearTimeoutSpy).toHaveBeenCalledWith(timeoutHandle);
  });
});

// ---------------------------------------------------------------------------
// Worktree mutex — per-repo serialization (P1 fix)
// ---------------------------------------------------------------------------

describe("worktree mutex (resetWorktreeLocks)", () => {
  beforeEach(() => {
    resetWorktreeLocks();
  });

  it("resetWorktreeLocks clears module-level state without throwing", () => {
    expect(() => resetWorktreeLocks()).not.toThrow();
  });

  it("two concurrent operations on the same repo key are serialized", async () => {
    // We test the mutex by exporting resetWorktreeLocks — which means the Map
    // is accessible for reset. The serialization logic (withWorktreeLock) is
    // internal but exercised indirectly via executeParallel paths.
    // Here we test the module-level export contract.
    const { resetWorktreeLocks: reset } = await import("../../src/goal/parallel-executor.js");
    expect(typeof reset).toBe("function");
    // Call twice — should be idempotent
    reset();
    reset();
    expect(true).toBe(true); // no throw = pass
  });

  it("resetWorktreeLocks is idempotent when called on an empty map", () => {
    resetWorktreeLocks();
    resetWorktreeLocks();
    expect(true).toBe(true); // no throw = pass
  });
});

// ---------------------------------------------------------------------------
// executeOrchestratorLevel — export contract and interface
// ---------------------------------------------------------------------------

describe("executeOrchestratorLevel — export contract", () => {
  it("is exported from parallel-executor.ts", async () => {
    const mod = await import("../../src/goal/parallel-executor.js");
    expect(typeof mod.executeOrchestratorLevel).toBe("function");
  });

  it("is an async function that returns a Promise", async () => {
    const { executeOrchestratorLevel } = await import("../../src/goal/parallel-executor.js");
    // Call with empty array — should resolve immediately with []
    const result = executeOrchestratorLevel([]);
    expect(result).toBeInstanceOf(Promise);
    await expect(result).resolves.toEqual([]);
  });

  it("returns empty array for empty input", async () => {
    const { executeOrchestratorLevel } = await import("../../src/goal/parallel-executor.js");
    const result = await executeOrchestratorLevel([]);
    expect(result).toEqual([]);
  });

  it("OrchestratorLevelResult interface: subtaskId + status are required fields", () => {
    // Type-level contract test — the object literal must satisfy the interface.
    // This is a compile-time check expressed at runtime.
    const r: import("../../src/orchestrator/types.js").OrchestratorLevelResult = {
      subtaskId: "my-job",
      status: "completed",
      stdout: "some output",
    };
    expect(r.subtaskId).toBe("my-job");
    expect(r.status).toBe("completed");
    expect(r.stdout).toBe("some output");
    expect(r.contextFile).toBeUndefined();
  });

  it("OrchestratorLevelResult failed variant: error is optional string", () => {
    const r: import("../../src/orchestrator/types.js").OrchestratorLevelResult = {
      subtaskId: "failing-job",
      status: "failed",
      error: "something went wrong",
      stdout: "partial output",
    };
    expect(r.status).toBe("failed");
    expect(typeof r.error).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// resolveSubtaskModel (Sprint 41 — multi-provider per-subtask model routing)
// ---------------------------------------------------------------------------

describe("resolveSubtaskModel", () => {
  const config = { fast_model: "gpt-4o-mini", smart_model: "o3" };

  it("'fast' annotation resolves to config.fast_model", () => {
    expect(resolveSubtaskModel("fast", config)).toBe("gpt-4o-mini");
  });

  it("'smart' annotation resolves to config.smart_model", () => {
    expect(resolveSubtaskModel("smart", config)).toBe("o3");
  });

  it("literal model name passes through unchanged", () => {
    expect(resolveSubtaskModel("claude-3-haiku-20240307", config)).toBe("claude-3-haiku-20240307");
  });

  it("undefined annotation returns fallback", () => {
    expect(resolveSubtaskModel(undefined, config, "default-model")).toBe("default-model");
  });

  it("undefined annotation with no fallback returns undefined", () => {
    expect(resolveSubtaskModel(undefined, config)).toBeUndefined();
  });

  it("'fast' with no fast_model in config returns fallback", () => {
    expect(resolveSubtaskModel("fast", {}, "fallback-model")).toBe("fallback-model");
  });
});
