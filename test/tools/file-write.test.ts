import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileWriteTool } from "../../src/tools/file-write.js";

describe("file_write", () => {
  let tmpDir: string;

  /** Return a relative path inside tmpDir for use with the tool. */
  const rel = (filename: string) =>
    relative(process.cwd(), join(tmpDir, filename));

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(process.cwd(), ".test-file-write-"));
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true }).catch(() => {});
  });

  // --- Happy path ---

  it("writes a new file", async () => {
    const r = rel("new.txt");
    const result = await fileWriteTool.execute({ path: r, content: "hello world" });
    expect(result.success).toBe(true);
    const contents = await readFile(join(process.cwd(), r), "utf-8");
    expect(contents).toBe("hello world");
  });

  it("overwrites an existing file", async () => {
    const r = rel("existing.txt");
    await writeFile(join(process.cwd(), r), "original");
    const result = await fileWriteTool.execute({ path: r, content: "updated" });
    expect(result.success).toBe(true);
    const contents = await readFile(join(process.cwd(), r), "utf-8");
    expect(contents).toBe("updated");
  });

  it("output includes byte count", async () => {
    const r = rel("bytecount.txt");
    const result = await fileWriteTool.execute({ path: r, content: "hello" });
    expect(result.success).toBe(true);
    expect(result.output).toContain("5 bytes");
  });

  it("creates nested directories when createDirs is true", async () => {
    const r = rel("a/b/c/nested.txt");
    const result = await fileWriteTool.execute({
      path: r,
      content: "nested content",
      createDirs: true,
    });
    expect(result.success).toBe(true);
    const contents = await readFile(join(process.cwd(), r), "utf-8");
    expect(contents).toBe("nested content");
  });

  it("allows writing an empty file that does not exist", async () => {
    const r = rel("empty-new.txt");
    const result = await fileWriteTool.execute({ path: r, content: "" });
    expect(result.success).toBe(true);
  });

  // --- Safety: empty write guard ---

  it("rejects empty content write to an existing file", async () => {
    const r = rel("notempty.txt");
    await writeFile(join(process.cwd(), r), "valuable data");
    const result = await fileWriteTool.execute({ path: r, content: "" });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/truncate/);
    // File must be unchanged
    const contents = await readFile(join(process.cwd(), r), "utf-8");
    expect(contents).toBe("valuable data");
  });

  // --- Sandbox enforcement ---

  it("rejects absolute paths outside project directory", async () => {
    const result = await fileWriteTool.execute({
      path: "/tmp/evil-phase2s.txt",
      content: "evil",
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/outside project directory/);
  });

  it("rejects relative path escape via ..", async () => {
    const result = await fileWriteTool.execute({
      path: "../../tmp/evil.txt",
      content: "evil",
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/outside project directory/);
  });
});
