import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { assertInSandbox } from "../../src/tools/sandbox.js";

/**
 * Sandbox tests focus on the realpath()-based enforcement.
 * Key cases: symlinks inside project pointing outside, normal paths, ENOENT.
 */
describe("assertInSandbox", () => {
  let tmpDir: string;

  beforeAll(async () => {
    // tmpDir is inside cwd so it passes the sandbox check for normal files
    tmpDir = await mkdtemp(join(process.cwd(), ".test-sandbox-"));
    // Write a real file
    await writeFile(join(tmpDir, "real.txt"), "hello");
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true }).catch(() => {});
  });

  // --- Happy path ---

  it("returns resolved path for a file inside cwd", async () => {
    const relPath = ".test-sandbox-" + tmpDir.split(".test-sandbox-")[1] + "/real.txt";
    // Use the full relative path from cwd
    const absPath = join(tmpDir, "real.txt");
    const cwd = process.cwd();
    const result = await assertInSandbox(absPath.replace(cwd + "/", ""), cwd);
    expect(result).toBe(absPath);
  });

  it("accepts a path that doesn't exist yet (new file — ENOENT lexical fallback)", async () => {
    const newFile = join(tmpDir, "not-yet.txt");
    const relPath = newFile.replace(process.cwd() + "/", "");
    const result = await assertInSandbox(relPath);
    expect(result).toContain("not-yet.txt");
    expect(result.startsWith(process.cwd())).toBe(true);
  });

  // --- Sandbox violation ---

  it("throws for a path above cwd (../.. style)", async () => {
    await expect(assertInSandbox("../../etc/passwd")).rejects.toThrow(
      "Path outside project directory",
    );
  });

  it("throws for an absolute path outside cwd", async () => {
    await expect(assertInSandbox("/etc/hosts")).rejects.toThrow(
      "Path outside project directory",
    );
  });

  // --- Symlink tests ---

  it("blocks a symlink inside project pointing outside cwd", async () => {
    const linkPath = join(tmpDir, "escape-link");
    try {
      await symlink("/etc", linkPath);
    } catch {
      // symlink may fail in restricted environments — skip gracefully
      return;
    }
    const relPath = linkPath.replace(process.cwd() + "/", "");
    await expect(assertInSandbox(relPath)).rejects.toThrow(
      "Path outside project directory",
    );
    await rm(linkPath).catch(() => {});
  });

  it("allows a symlink inside project pointing to another file inside cwd", async () => {
    const target = join(tmpDir, "real.txt");
    const linkPath = join(tmpDir, "internal-link");
    try {
      await symlink(target, linkPath);
    } catch {
      return;
    }
    const relPath = linkPath.replace(process.cwd() + "/", "");
    const result = await assertInSandbox(relPath);
    // Should resolve to the real target, still inside cwd
    expect(result.startsWith(process.cwd())).toBe(true);
    await rm(linkPath).catch(() => {});
  });
});
