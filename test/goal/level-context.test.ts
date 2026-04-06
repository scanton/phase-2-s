import { describe, it, expect } from "vitest";
import { buildLevelContext } from "../../src/goal/level-context.js";

// These tests run against the real git repo. buildLevelContext calls git
// commands, so tests verify behavior with the actual repo state.

describe("buildLevelContext", () => {
  it("returns empty string when comparing HEAD to itself (no changes)", () => {
    // HEAD..HEAD has no diff — should return empty
    const ctx = buildLevelContext(process.cwd(), "HEAD");
    expect(ctx).toBe("");
  });

  it("returns empty string for invalid commit hash", () => {
    // Bad hash — git command fails, function returns empty gracefully
    const ctx = buildLevelContext(process.cwd(), "0000000000000000000000000000000000000000");
    expect(ctx).toBe("");
  });

  it("returns empty string for nonexistent directory", () => {
    const ctx = buildLevelContext("/nonexistent/path", "HEAD");
    expect(ctx).toBe("");
  });

  it("is a pure function (no side effects)", () => {
    // Calling twice with same args returns same result
    const a = buildLevelContext(process.cwd(), "HEAD");
    const b = buildLevelContext(process.cwd(), "HEAD");
    expect(a).toBe(b);
  });
});
