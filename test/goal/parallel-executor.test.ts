import { describe, it, expect } from "vitest";
import { makeWorktreeSlug } from "../../src/goal/parallel-executor.js";

// Note: Most parallel executor tests require mocking child_process, Agent, etc.
// These are the pure function tests. Integration tests for the full executor
// require a real git repo and are better suited for E2E testing.

describe("makeWorktreeSlug", () => {
  it("creates a slug from subtask name and index", () => {
    const slug = makeWorktreeSlug("Auth Module", 0);
    expect(slug).toMatch(/^auth-module-0-[a-z0-9]+$/);
  });

  it("handles special characters in name", () => {
    const slug = makeWorktreeSlug("Create src/api/routes.ts + tests!", 2);
    expect(slug).toMatch(/^create-src-api-routes-ts-tests-2-[a-z0-9]+$/);
  });

  it("truncates long names", () => {
    const longName = "A".repeat(100);
    const slug = makeWorktreeSlug(longName, 0);
    // 40 chars max for name part + index + hash
    expect(slug.length).toBeLessThan(60);
  });

  it("handles empty name", () => {
    const slug = makeWorktreeSlug("", 5);
    expect(slug).toMatch(/^-5-[a-z0-9]+$/);
  });

  it("generates unique slugs for same name", () => {
    const slug1 = makeWorktreeSlug("test", 0);
    const slug2 = makeWorktreeSlug("test", 0);
    expect(slug1).not.toBe(slug2); // Random hash differs
  });
});
