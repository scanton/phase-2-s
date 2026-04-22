import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Mock assertInSandbox so tests control the resolved path
vi.mock("../../src/tools/sandbox.js", () => ({
  assertInSandbox: vi.fn(async (token: string, cwd: string) => {
    // Default: resolve to cwd/token (well-behaved)
    return join(cwd, token);
  }),
}));

import {
  parseAttachTokens,
  readWithSizeGuard,
  formatAttachmentBlock,
  makeCompleter,
  expandAttachments,
  AttachedFile,
} from "../../src/cli/file-attachment.js";
import { assertInSandbox } from "../../src/tools/sandbox.js";

// ---------------------------------------------------------------------------
// parseAttachTokens
// ---------------------------------------------------------------------------

describe("parseAttachTokens", () => {
  it("extracts a bare @token", () => {
    expect(parseAttachTokens("@src/core/agent.ts")).toEqual(["src/core/agent.ts"]);
  });

  it("extracts multiple tokens", () => {
    expect(parseAttachTokens("Explain @src/core/agent.ts and @Makefile")).toEqual([
      "src/core/agent.ts",
      "Makefile",
    ]);
  });

  it("ignores email addresses (word char before @)", () => {
    expect(parseAttachTokens("user@domain.com")).toEqual([]);
  });

  it("handles extensionless files", () => {
    expect(parseAttachTokens("@Makefile")).toEqual(["Makefile"]);
  });

  it("handles dotfiles", () => {
    expect(parseAttachTokens("@.env")).toEqual([".env"]);
  });

  it("returns empty array when no tokens", () => {
    expect(parseAttachTokens("just a normal question")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// readWithSizeGuard
// ---------------------------------------------------------------------------

describe("readWithSizeGuard", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "phase2s-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("reads a small file with no warning", async () => {
    const content = "hello world\n";
    writeFileSync(join(tmpDir, "small.txt"), content);
    const result = await readWithSizeGuard("small.txt", tmpDir);
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.content).toBe(content);
      expect(result.sizeWarning).toBe("none");
      expect(result.lineCount).toBe(2); // "hello world\n".split("\n") = ["hello world", ""]
    }
  });

  it("warns on files 201-500 lines", async () => {
    const lines = Array.from({ length: 300 }, (_, i) => `line ${i}`).join("\n");
    writeFileSync(join(tmpDir, "medium.txt"), lines);
    const result = await readWithSizeGuard("medium.txt", tmpDir);
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.sizeWarning).toBe("warned");
      expect(result.content).toBe(lines);
    }
  });

  it("truncates files over 500 lines", async () => {
    const lines = Array.from({ length: 600 }, (_, i) => `line ${i}`).join("\n");
    writeFileSync(join(tmpDir, "large.txt"), lines);
    const result = await readWithSizeGuard("large.txt", tmpDir, 200);
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.sizeWarning).toBe("truncated");
      expect(result.content).toContain("[truncated]");
      const contentLines = result.content.split("\n");
      expect(contentLines.length).toBeLessThanOrEqual(202); // 200 lines + [truncated] + trailing newline
    }
  });

  it("rejects files over 20KB", async () => {
    const bigContent = "x".repeat(21 * 1024);
    writeFileSync(join(tmpDir, "big.txt"), bigContent);
    const result = await readWithSizeGuard("big.txt", tmpDir);
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("too large");
    }
  });

  it("returns error for missing file", async () => {
    const result = await readWithSizeGuard("nonexistent.ts", tmpDir);
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("not found");
    }
  });

  it("returns error for directory", async () => {
    mkdirSync(join(tmpDir, "subdir"));
    const result = await readWithSizeGuard("subdir", tmpDir);
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("directory");
    }
  });

  it("returns error on path traversal", async () => {
    vi.mocked(assertInSandbox).mockRejectedValueOnce(new Error("Path outside project directory"));
    const result = await readWithSizeGuard("../../etc/passwd", tmpDir);
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("outside project");
    }
  });
});

// ---------------------------------------------------------------------------
// formatAttachmentBlock
// ---------------------------------------------------------------------------

describe("formatAttachmentBlock", () => {
  it("returns empty string for no files", () => {
    expect(formatAttachmentBlock([])).toBe("");
  });

  it("wraps a single file in <file> tags", () => {
    const file: AttachedFile = {
      path: "src/foo.ts",
      resolvedPath: "/abs/src/foo.ts",
      content: "const x = 1;",
      lineCount: 1,
      sizeWarning: "none",
    };
    const block = formatAttachmentBlock([file]);
    expect(block).toContain('<file path="src/foo.ts">');
    expect(block).toContain("const x = 1;");
    expect(block).toContain("</file>");
  });

  it("joins multiple files with newlines", () => {
    const files: AttachedFile[] = [
      { path: "a.ts", resolvedPath: "/a.ts", content: "a", lineCount: 1, sizeWarning: "none" },
      { path: "b.ts", resolvedPath: "/b.ts", content: "b", lineCount: 1, sizeWarning: "none" },
    ];
    const block = formatAttachmentBlock(files);
    expect(block).toContain('path="a.ts"');
    expect(block).toContain('path="b.ts"');
  });
});

// ---------------------------------------------------------------------------
// expandAttachments
// ---------------------------------------------------------------------------

describe("expandAttachments", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "phase2s-test-"));
    vi.restoreAllMocks();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns unchanged line when no @tokens", async () => {
    const { cleanLine, preamble, attached } = await expandAttachments("normal question", tmpDir);
    expect(cleanLine).toBe("normal question");
    expect(preamble).toBe("");
    expect(attached).toHaveLength(0);
  });

  it("inlines a file and removes @token from cleanLine", async () => {
    writeFileSync(join(tmpDir, "foo.ts"), "export const x = 1;\n");
    const { cleanLine, preamble, attached } = await expandAttachments("Explain @foo.ts", tmpDir);
    expect(cleanLine).toBe("Explain");
    expect(preamble).toContain('<file path="foo.ts">');
    expect(attached).toHaveLength(1);
  });

  it("preserves @token in cleanLine on read error", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { cleanLine, preamble, attached } = await expandAttachments("@missing.ts question", tmpDir);
    expect(cleanLine).toContain("@missing.ts");
    expect(preamble).toBe("");
    expect(attached).toHaveLength(0);
    expect(stderrSpy).toHaveBeenCalled();
  });

  it("does not expand email addresses as tokens", async () => {
    const { cleanLine, preamble } = await expandAttachments("email user@domain.com here", tmpDir);
    expect(cleanLine).toBe("email user@domain.com here");
    expect(preamble).toBe("");
  });
});
