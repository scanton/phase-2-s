import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { grepTool } from "../../src/tools/grep-tool.js";

describe("grep", () => {
  let tmpDir: string;

  /** Return a relative path inside tmpDir for use with the tool. */
  const rel = (subpath: string) =>
    relative(process.cwd(), join(tmpDir, subpath));

  beforeAll(async () => {
    // Create temp dir INSIDE cwd so it passes the sandbox check
    tmpDir = await mkdtemp(join(process.cwd(), ".test-grep-"));

    // Fixture layout:
    //   alpha.ts  — contains "hello world" and "TODO: fix this"
    //   beta.ts   — contains "Hello World" (capital H/W) and "goodbye"
    //   sub/
    //     gamma.js — contains "hello" and "HELLO"
    await writeFile(join(tmpDir, "alpha.ts"), "hello world\nTODO: fix this\nend of alpha\n");
    await writeFile(join(tmpDir, "beta.ts"), "Hello World\ngoodbye\nend of beta\n");
    await mkdir(join(tmpDir, "sub"));
    await writeFile(join(tmpDir, "sub", "gamma.js"), "hello\nHELLO\nend of gamma\n");
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true }).catch(() => {});
  });

  // --- Happy path ---

  it("finds a pattern in files", async () => {
    const result = await grepTool.execute({
      pattern: "hello world",
      path: rel(""),
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain("hello world");
    expect(result.output).toContain("alpha.ts");
  });

  it("returns no-match message when pattern finds nothing", async () => {
    const result = await grepTool.execute({
      pattern: "zzznotfound",
      path: rel(""),
    });
    expect(result.success).toBe(true);
    expect(result.output).toBe("No matches found.");
  });

  it("searches case-insensitively when caseSensitive is false", async () => {
    const result = await grepTool.execute({
      pattern: "hello world",
      path: rel(""),
      caseSensitive: false,
    });
    expect(result.success).toBe(true);
    // Should match both "hello world" (alpha.ts) and "Hello World" (beta.ts)
    expect(result.output).toContain("alpha.ts");
    expect(result.output).toContain("beta.ts");
  });

  it("searches case-sensitively by default (no caseSensitive flag)", async () => {
    const result = await grepTool.execute({
      pattern: "hello world",
      path: rel(""),
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain("alpha.ts");
    // "Hello World" in beta.ts must NOT match
    expect(result.output).not.toContain("beta.ts");
  });

  it("restricts search to filePattern", async () => {
    const result = await grepTool.execute({
      pattern: "hello",
      path: rel(""),
      filePattern: "*.ts",
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain("alpha.ts");
    // gamma.js must not appear
    expect(result.output).not.toContain("gamma.js");
  });

  it("truncates results to maxResults lines", async () => {
    // Write a file with many matching lines
    const lines = Array.from({ length: 20 }, (_, i) => `match line ${i}`).join("\n");
    await writeFile(join(tmpDir, "many.ts"), lines + "\n");

    const result = await grepTool.execute({
      pattern: "match line",
      path: rel(""),
      maxResults: 5,
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain("truncated");
  });

  // --- Sandbox enforcement ---

  it("rejects path outside project directory", async () => {
    const result = await grepTool.execute({
      pattern: "hello",
      path: "/tmp",
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/outside project directory/);
  });

  it("rejects path escape via ..", async () => {
    const result = await grepTool.execute({
      pattern: "hello",
      path: "../..",
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/outside project directory/);
  });
});
