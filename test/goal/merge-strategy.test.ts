import { describe, it, expect } from "vitest";
import { makeWorktreeSlug } from "../../src/goal/parallel-executor.js";

// These tests cover pure functions and edge cases that don't require mocking.
// The git-dependent functions (mergeWorktree, createWorktree, etc.) are tested
// via integration tests that run in a real git repo.

describe("makeWorktreeSlug (via parallel-executor)", () => {
  it("creates a slug from subtask name and index", () => {
    const slug = makeWorktreeSlug("Auth Module", 0);
    expect(slug).toMatch(/^auth-module-0-[a-z0-9]+$/);
  });

  it("handles special characters", () => {
    const slug = makeWorktreeSlug("Create src/api/routes.ts", 2);
    expect(slug).toMatch(/^create-src-api-routes-ts-2-[a-z0-9]+$/);
  });

  it("truncates long names", () => {
    const slug = makeWorktreeSlug("A".repeat(100), 0);
    expect(slug.length).toBeLessThan(60);
  });
});

// ---------------------------------------------------------------------------
// Merge strategy pure logic tests
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
