import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { globTool } from "../../src/tools/glob-tool.js";

describe("glob", () => {
  let tmpDir: string;

  /** Return a relative path inside tmpDir for use with the tool. */
  const rel = (subpath: string) =>
    relative(process.cwd(), join(tmpDir, subpath));

  beforeAll(async () => {
    // Create temp dir INSIDE cwd so it passes the sandbox check
    tmpDir = await mkdtemp(join(process.cwd(), ".test-glob-"));

    // Fixture layout:
    //   a.ts
    //   b.ts
    //   notes.md
    //   sub/
    //     c.ts
    //     d.js
    //   sub/nested/
    //     e.ts
    await writeFile(join(tmpDir, "a.ts"), "// a");
    await writeFile(join(tmpDir, "b.ts"), "// b");
    await writeFile(join(tmpDir, "notes.md"), "# notes");
    await mkdir(join(tmpDir, "sub"));
    await writeFile(join(tmpDir, "sub", "c.ts"), "// c");
    await writeFile(join(tmpDir, "sub", "d.js"), "// d");
    await mkdir(join(tmpDir, "sub", "nested"));
    await writeFile(join(tmpDir, "sub", "nested", "e.ts"), "// e");
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true }).catch(() => {});
  });

  // --- Happy path ---

  it("matches .ts files in the root", async () => {
    const result = await globTool.execute({
      pattern: "*.ts",
      cwd: rel(""),
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain("a.ts");
    expect(result.output).toContain("b.ts");
    expect(result.output).not.toContain("notes.md");
  });

  it("matches files recursively with **", async () => {
    const result = await globTool.execute({
      pattern: "**/*.ts",
      cwd: rel(""),
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain("a.ts");
    expect(result.output).toContain("b.ts");
    expect(result.output).toContain("sub/c.ts");
    expect(result.output).toContain("sub/nested/e.ts");
  });

  it("matches files in a subdirectory", async () => {
    const result = await globTool.execute({
      pattern: "*.ts",
      cwd: rel("sub"),
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain("c.ts");
    expect(result.output).not.toContain("a.ts");
  });

  it("returns no-match message when pattern finds nothing", async () => {
    const result = await globTool.execute({
      pattern: "*.rb",
      cwd: rel(""),
    });
    expect(result.success).toBe(true);
    expect(result.output).toBe("No files matched the pattern.");
  });

  it("respects custom ignore patterns", async () => {
    const result = await globTool.execute({
      pattern: "**/*.ts",
      cwd: rel(""),
      ignore: ["sub/**"],
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain("a.ts");
    expect(result.output).not.toContain("sub/c.ts");
    expect(result.output).not.toContain("sub/nested/e.ts");
  });

  it("does not return directories, only files", async () => {
    const result = await globTool.execute({
      pattern: "**",
      cwd: rel(""),
    });
    expect(result.success).toBe(true);
    // 'sub' and 'sub/nested' are dirs — they must not appear as bare entries
    const lines = result.output.split("\n");
    expect(lines.every((l) => !l.match(/^sub\/?$/) && !l.match(/^sub\/nested\/?$/))).toBe(true);
  });

  // --- Sandbox enforcement ---

  it("rejects cwd outside project directory", async () => {
    const result = await globTool.execute({
      pattern: "*.ts",
      cwd: "/tmp",
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/outside project directory/);
  });

  it("rejects cwd escape via ..", async () => {
    const result = await globTool.execute({
      pattern: "*.ts",
      cwd: "../..",
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/outside project directory/);
  });

  // --- Default ignore ---

  it("ignores node_modules by default", async () => {
    // Create a fake node_modules file in the fixture dir
    await mkdir(join(tmpDir, "node_modules")).catch(() => {});
    await writeFile(join(tmpDir, "node_modules", "pkg.ts"), "// pkg");
    const result = await globTool.execute({
      pattern: "**/*.ts",
      cwd: rel(""),
    });
    expect(result.success).toBe(true);
    expect(result.output).not.toContain("node_modules");
  });
});
