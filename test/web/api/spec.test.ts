/**
 * Tests for assertInProject path traversal guard (Sprint 94)
 *
 * assertInProject now uses fs.realpath() (not path.resolve()) to dereference
 * symlinks before comparing paths. Tests use real temp directories.
 *
 * Tests cover:
 * 1. Valid path within cwd — no throw
 * 2. Absolute path outside project — throws "path traversal"
 * 3. Symlink pointing outside project — throws "path traversal" (NEW: symlink-safe)
 * 4. Non-existent path within project — throws ENOENT (realpath can't resolve)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assertInProject } from "../../../src/web/api/runs.js";

function tmpRoot(): string {
  return join(tmpdir(), `p2s-guard-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

describe("assertInProject (realpath-based path traversal guard)", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = tmpRoot();
    await mkdir(join(cwd, ".phase2s", "specs"), { recursive: true });
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("allows a real file within the project root", async () => {
    const specFile = join(cwd, ".phase2s", "specs", "my-spec.md");
    await writeFile(specFile, "# Spec");
    await expect(assertInProject(specFile, cwd)).resolves.toBeUndefined();
  });

  it("allows cwd itself (real directory)", async () => {
    await expect(assertInProject(cwd, cwd)).resolves.toBeUndefined();
  });

  it("blocks a real file outside the project root", async () => {
    // Create a file outside the project
    const outsideDir = tmpRoot();
    await mkdir(outsideDir, { recursive: true });
    const outsideFile = join(outsideDir, "secret.txt");
    await writeFile(outsideFile, "secret");
    try {
      await expect(assertInProject(outsideFile, cwd)).rejects.toThrow(/path traversal/);
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("blocks a symlink whose realpath is outside the project root (symlink bypass prevented)", async () => {
    // Create a file outside the project
    const outsideDir = tmpRoot();
    await mkdir(outsideDir, { recursive: true });
    const outsideFile = join(outsideDir, "secret.txt");
    await writeFile(outsideFile, "secret");

    // Create a symlink inside the project pointing to the outside file
    const symlinkPath = join(cwd, ".phase2s", "specs", "evil-link.md");
    await symlink(outsideFile, symlinkPath);

    try {
      // Old code (path.resolve) would allow this — real path resolves outside
      // New code (fs.realpath) correctly blocks it
      await expect(assertInProject(symlinkPath, cwd)).rejects.toThrow(/path traversal/);
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("throws ENOENT for a non-existent path within the project", async () => {
    const missing = join(cwd, ".phase2s", "specs", "does-not-exist.md");
    // realpath throws ENOENT; callers treat this as "file not found" (404/null)
    await expect(assertInProject(missing, cwd)).rejects.toThrow(/ENOENT/);
  });

  it("blocks a sibling directory (real file)", async () => {
    const siblingDir = tmpRoot();
    await mkdir(siblingDir, { recursive: true });
    const siblingFile = join(siblingDir, "data.txt");
    await writeFile(siblingFile, "data");
    try {
      await expect(assertInProject(siblingFile, cwd)).rejects.toThrow(/path traversal/);
    } finally {
      await rm(siblingDir, { recursive: true, force: true });
    }
  });
});
