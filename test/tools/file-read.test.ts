import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileReadTool } from "../../src/tools/file-read.js";

describe("file_read", () => {
  let tmpDir: string;
  let testFile: string;
  let relTestFile: string;

  beforeAll(async () => {
    // Create temp dir INSIDE cwd so it passes the sandbox check
    tmpDir = await mkdtemp(join(process.cwd(), ".test-file-read-"));
    testFile = join(tmpDir, "sample.txt");
    await writeFile(
      testFile,
      "line1\nline2\nline3\nline4\nline5\n",
    );
    relTestFile = relative(process.cwd(), testFile);
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true }).catch(() => {});
  });

  // --- Happy path ---

  it("reads an entire file", async () => {
    const result = await fileReadTool.execute({ path: relTestFile });
    expect(result.success).toBe(true);
    expect(result.output).toContain("line1");
    expect(result.output).toContain("line5");
  });

  it("reads a specific line range", async () => {
    const result = await fileReadTool.execute({
      path: relTestFile,
      startLine: 2,
      endLine: 3,
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain("line2");
    expect(result.output).toContain("line3");
    expect(result.output).not.toContain("line1");
    expect(result.output).not.toContain("line4");
  });

  it("line numbers are 1-based in output", async () => {
    const result = await fileReadTool.execute({
      path: relTestFile,
      startLine: 2,
      endLine: 2,
    });
    expect(result.success).toBe(true);
    // Output format: "2\tline2"
    expect(result.output).toMatch(/^2\t/);
  });

  it("reads from startLine to end when endLine is omitted", async () => {
    const result = await fileReadTool.execute({
      path: relTestFile,
      startLine: 4,
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain("line4");
    expect(result.output).toContain("line5");
    expect(result.output).not.toContain("line3");
  });

  // --- Sandbox enforcement ---

  it("rejects absolute paths outside project directory", async () => {
    const result = await fileReadTool.execute({ path: "/etc/passwd" });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/outside project directory/);
  });

  it("rejects relative path escape via ..", async () => {
    const result = await fileReadTool.execute({ path: "../../etc/passwd" });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/outside project directory/);
  });

  it("rejects home directory paths", async () => {
    const result = await fileReadTool.execute({
      path: `${process.env.HOME}/.ssh/id_rsa`,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/outside project directory/);
  });

  // --- Error handling ---

  it("returns failure for a nonexistent file", async () => {
    const result = await fileReadTool.execute({
      path: "definitely-does-not-exist-xyz.txt",
    });
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("sanitizes absolute paths from error messages", async () => {
    const result = await fileReadTool.execute({
      path: "does-not-exist.txt",
    });
    expect(result.success).toBe(false);
    // Must not leak the full path to the LLM
    expect(result.error).not.toMatch(/\/Users\//);
    expect(result.error).not.toMatch(/\/home\//);
  });
});
