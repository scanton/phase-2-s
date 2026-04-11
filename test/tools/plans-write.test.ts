/**
 * Tests for the sandboxed plans_write tool.
 *
 * Verifies:
 * - Writes inside plans/ succeed
 * - Writes outside plans/ are rejected (path traversal, sibling directories)
 * - Separator-aware check (plans-evil/ does not match plans/)
 * - Auto-creates plans/ directory on first write
 * - Refuses to truncate an existing file to empty content
 * - Overwrites existing files with new content
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createPlansWriteTool } from "../../src/tools/plans-write.js";

async function makeTmpCwd(): Promise<string> {
  const dir = join(tmpdir(), `plans-write-test-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

describe("plans_write tool", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await makeTmpCwd();
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  // --- Happy path ---

  it("writes a file inside plans/", async () => {
    const tool = createPlansWriteTool(cwd);
    const result = await tool.execute({ path: "plans/my-plan.md", content: "# My Plan\n\nContent here." });
    expect(result.success).toBe(true);
    const written = await readFile(join(cwd, "plans", "my-plan.md"), "utf-8");
    expect(written).toBe("# My Plan\n\nContent here.");
  });

  it("auto-creates the plans/ directory on first write", async () => {
    const tool = createPlansWriteTool(cwd);
    // plans/ does not exist yet
    const result = await tool.execute({ path: "plans/new-plan.md", content: "Plan content." });
    expect(result.success).toBe(true);
    const written = await readFile(join(cwd, "plans", "new-plan.md"), "utf-8");
    expect(written).toBe("Plan content.");
  });

  it("auto-creates nested directories inside plans/", async () => {
    const tool = createPlansWriteTool(cwd);
    const result = await tool.execute({ path: "plans/sprint/task.md", content: "Nested plan." });
    expect(result.success).toBe(true);
    const written = await readFile(join(cwd, "plans", "sprint", "task.md"), "utf-8");
    expect(written).toBe("Nested plan.");
  });

  it("overwrites an existing plans/ file with new content", async () => {
    await mkdir(join(cwd, "plans"), { recursive: true });
    await writeFile(join(cwd, "plans", "existing.md"), "Old content.");

    const tool = createPlansWriteTool(cwd);
    const result = await tool.execute({ path: "plans/existing.md", content: "New content." });
    expect(result.success).toBe(true);
    const written = await readFile(join(cwd, "plans", "existing.md"), "utf-8");
    expect(written).toBe("New content.");
  });

  it("reports 'Overwrote' for an existing file", async () => {
    await mkdir(join(cwd, "plans"), { recursive: true });
    await writeFile(join(cwd, "plans", "existing.md"), "Original content.");

    const tool = createPlansWriteTool(cwd);
    const result = await tool.execute({ path: "plans/existing.md", content: "Updated." });
    expect(result.success).toBe(true);
    expect(result.output).toContain("Overwrote");
  });

  it("reports 'Wrote' for a new file", async () => {
    const tool = createPlansWriteTool(cwd);
    const result = await tool.execute({ path: "plans/fresh.md", content: "Fresh content." });
    expect(result.success).toBe(true);
    expect(result.output).toContain("Wrote");
  });

  // --- Sandbox enforcement ---

  it("rejects path traversal outside plans/ via ../", async () => {
    const tool = createPlansWriteTool(cwd);
    const result = await tool.execute({ path: "plans/../evil.md", content: "Should not write." });
    expect(result.success).toBe(false);
    expect(result.error).toContain("outside plans directory");
  });

  it("rejects absolute path outside plans/", async () => {
    const tool = createPlansWriteTool(cwd);
    const result = await tool.execute({ path: "/etc/passwd", content: "Should not write." });
    expect(result.success).toBe(false);
    expect(result.error).toContain("outside plans directory");
  });

  it("rejects sibling directory that starts with 'plans' (separator check)", async () => {
    // plans-evil/ is a sibling of plans/ that has the 'plans' prefix.
    // Without separator-aware check, 'plans-evil/' could slip through.
    const tool = createPlansWriteTool(cwd);
    const result = await tool.execute({ path: "plans-evil/attack.md", content: "Should not write." });
    expect(result.success).toBe(false);
    expect(result.error).toContain("outside plans directory");
  });

  it("rejects a path that resolves to plans/ itself (not a file)", async () => {
    const tool = createPlansWriteTool(cwd);
    // Writing to "plans" (without filename) resolves to the plans/ directory itself.
    // The sandbox requires startsWith(plansDir + sep), so the directory itself is rejected.
    const result = await tool.execute({ path: "plans", content: "Should not write." });
    expect(result.success).toBe(false);
    expect(result.error).toContain("outside plans directory");
  });

  it("rejects path with multiple ../ escapes", async () => {
    const tool = createPlansWriteTool(cwd);
    const result = await tool.execute({ path: "plans/../../etc/passwd", content: "Should not write." });
    expect(result.success).toBe(false);
    expect(result.error).toContain("outside plans directory");
  });

  // --- Guard: refuse to truncate existing file to empty ---

  it("refuses to truncate an existing file to empty content", async () => {
    await mkdir(join(cwd, "plans"), { recursive: true });
    await writeFile(join(cwd, "plans", "nonempty.md"), "Important content.");

    const tool = createPlansWriteTool(cwd);
    const result = await tool.execute({ path: "plans/nonempty.md", content: "" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Refusing to truncate");
    // Verify original content is preserved
    const still = await readFile(join(cwd, "plans", "nonempty.md"), "utf-8");
    expect(still).toBe("Important content.");
  });

  it("allows writing empty content to a new file", async () => {
    const tool = createPlansWriteTool(cwd);
    const result = await tool.execute({ path: "plans/empty-new.md", content: "" });
    // New file — empty content is allowed
    expect(result.success).toBe(true);
  });

  it("treats whitespace-only content as empty for truncation guard", async () => {
    await mkdir(join(cwd, "plans"), { recursive: true });
    await writeFile(join(cwd, "plans", "existing.md"), "Actual content.");

    const tool = createPlansWriteTool(cwd);
    const result = await tool.execute({ path: "plans/existing.md", content: "   \n  " });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Refusing to truncate");
  });

  // --- Tool metadata ---

  it("has correct tool name 'plans_write'", () => {
    const tool = createPlansWriteTool(cwd);
    expect(tool.name).toBe("plans_write");
  });

  it("has a description mentioning plans/", () => {
    const tool = createPlansWriteTool(cwd);
    expect(tool.description).toContain("plans/");
  });
});
