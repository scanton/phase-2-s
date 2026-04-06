import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { buildLevelContext } from "../../src/goal/level-context.js";
import { makeTempRepo, commitFile, commitManyFiles, withTempRepo } from "./helpers.js";

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

// ---------------------------------------------------------------------------
// Integration tests using real temp repos
// ---------------------------------------------------------------------------

describe("buildLevelContext with real temp repos", () => {
  it("returns context containing filename and 'files changed' after a commit", async () => {
    await withTempRepo(async (cwd) => {
      // Capture the initial commit hash as our base
      const baseCommit = execSync("git rev-parse HEAD", { cwd, encoding: "utf8" }).trim();

      // Make a commit with a file
      commitFile(cwd, "index.ts", "export const hello = 'world';\n");

      const ctx = buildLevelContext(cwd, baseCommit);

      // Should contain the filename
      expect(ctx).toContain("index.ts");
      // Should contain the "files changed" summary from git diff --stat
      expect(ctx).toContain("file");
    });
  });

  it("truncates output to <= 4096 bytes and includes (truncated) marker", async () => {
    await withTempRepo(async (cwd) => {
      const baseCommit = execSync("git rev-parse HEAD", { cwd, encoding: "utf8" }).trim();

      // ~80 files with 40-char names generates diff stat > 4096 bytes
      commitManyFiles(cwd, 80);

      const ctx = buildLevelContext(cwd, baseCommit);

      expect(Buffer.byteLength(ctx, "utf8")).toBeLessThanOrEqual(4096);
      expect(ctx).toContain("(truncated)");
    });
  });

  it("returns empty string when base commit equals HEAD (no diff)", async () => {
    await withTempRepo(async (cwd) => {
      // HEAD..HEAD → no diff → empty string
      const ctx = buildLevelContext(cwd, "HEAD");
      expect(ctx).toBe("");
    });
  });
});
