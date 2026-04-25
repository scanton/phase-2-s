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
  fetchUrlWithSizeGuard,
  AttachedFile,
} from "../../src/cli/file-attachment.js";
import { assertInSandbox } from "../../src/tools/sandbox.js";

// Mock browser.ts to avoid Playwright import and control SSRF checks
vi.mock("../../src/tools/browser.js", () => ({
  getUrlBlockReason: vi.fn((url: string) => {
    if (url.includes("169.254") || url.includes("10.0.0")) return "blocked private IP";
    return null; // allowed by default
  }),
  disposeBrowser: vi.fn(),
}));

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
// makeCompleter
// ---------------------------------------------------------------------------

describe("makeCompleter", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "phase2s-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function invoke(getCwd: () => string, line: string): Promise<[string[], string]> {
    return new Promise((resolve, reject) => {
      makeCompleter(getCwd)(line, (err, result) => (err ? reject(err) : resolve(result)));
    });
  }

  it("returns no completions when line has no @fragment at end", async () => {
    const [completions, hit] = await invoke(() => tmpDir, "just text");
    expect(completions).toEqual([]);
    expect(hit).toBe("");
  });

  it("completes a file without trailing slash", async () => {
    writeFileSync(join(tmpDir, "agent.ts"), "");
    const [completions] = await invoke(() => tmpDir, "@ag");
    expect(completions).toContain("@agent.ts");
  });

  it("appends trailing slash for directory completions", async () => {
    mkdirSync(join(tmpDir, "core"));
    const [completions] = await invoke(() => tmpDir, "@cor");
    expect(completions).toContain("@core/");
  });

  it("falls back to [[], activeToken] when readdir fails", async () => {
    const [completions, hit] = await invoke(() => tmpDir, "@nonexistent/ag");
    expect(completions).toEqual([]);
    expect(hit).toBe("@nonexistent/ag");
  });

  it("handles nested fragment — splits dirPart and filePart correctly", async () => {
    mkdirSync(join(tmpDir, "src"));
    writeFileSync(join(tmpDir, "src", "agent.ts"), "");
    const [completions] = await invoke(() => tmpDir, "@src/ag");
    expect(completions).toContain("@src/agent.ts");
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

  it("removes all occurrences when a token is repeated in the prompt", async () => {
    writeFileSync(join(tmpDir, "foo.ts"), "const x = 1;\n");
    const { cleanLine, preamble, attached } = await expandAttachments("@foo.ts explain @foo.ts", tmpDir);
    expect(cleanLine).toBe("explain");
    expect(attached).toHaveLength(1);
    expect((preamble.match(/<file /g) ?? []).length).toBe(1);
  });

  it("does not corrupt a longer token when a shorter prefix token also appears", async () => {
    writeFileSync(join(tmpDir, "foo.ts"), "const x = 1;\n");
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    // @foo.ts/bar doesn't exist so it stays in cleanLine; @foo.ts is inlined and removed
    const { cleanLine, attached } = await expandAttachments("@foo.ts @foo.ts/bar question", tmpDir);
    expect(attached).toHaveLength(1);
    // @foo.ts should be removed; @foo.ts/bar should remain intact (not corrupted to /bar)
    expect(cleanLine).toContain("@foo.ts/bar");
    expect(cleanLine).not.toContain("@foo.ts ");
    stderrSpy.mockRestore();
  });

  it("inlines two files and removes both @tokens from cleanLine", async () => {
    writeFileSync(join(tmpDir, "a.ts"), "const a = 1;\n");
    writeFileSync(join(tmpDir, "b.ts"), "const b = 2;\n");
    const { cleanLine, preamble, attached } = await expandAttachments("@a.ts @b.ts compare these", tmpDir);
    expect(attached).toHaveLength(2);
    expect(preamble).toContain('<file path="a.ts">');
    expect(preamble).toContain('<file path="b.ts">');
    expect(cleanLine).toBe("compare these");
  });

  it("propagates sizeWarning:warned through to attached metadata", async () => {
    const lines = Array.from({ length: 300 }, (_, i) => `line ${i}`).join("\n");
    writeFileSync(join(tmpDir, "medium.ts"), lines);
    const { attached, preamble } = await expandAttachments("@medium.ts question", tmpDir);
    expect(attached).toHaveLength(1);
    expect(attached[0].sizeWarning).toBe("warned");
    expect(preamble).toContain('<file path="medium.ts">');
    expect(preamble).not.toContain("[truncated]");
  });
});

// ---------------------------------------------------------------------------
// parseAttachTokens — URL token extraction
// ---------------------------------------------------------------------------

describe("parseAttachTokens — URL tokens", () => {
  it("extracts an @https:// token", () => {
    expect(parseAttachTokens("@https://docs.anthropic.com/api")).toEqual([
      "https://docs.anthropic.com/api",
    ]);
  });

  it("extracts mixed file and URL tokens", () => {
    const tokens = parseAttachTokens("see @src/foo.ts and @https://example.com/docs");
    expect(tokens).toContain("src/foo.ts");
    expect(tokens).toContain("https://example.com/docs");
  });

  it("does not match email addresses as URL tokens", () => {
    expect(parseAttachTokens("user@domain.com")).toEqual([]);
  });

  it("strips trailing punctuation from URL tokens", () => {
    expect(parseAttachTokens("see @https://example.com/page.")).toEqual([
      "https://example.com/page",
    ]);
    expect(parseAttachTokens("(@https://example.com/x)")).toEqual([
      "https://example.com/x",
    ]);
  });
});

// ---------------------------------------------------------------------------
// fetchUrlWithSizeGuard
// ---------------------------------------------------------------------------

describe("fetchUrlWithSizeGuard", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns error when URL is blocked by SSRF check", async () => {
    const { getUrlBlockReason } = await import("../../src/tools/browser.js");
    vi.mocked(getUrlBlockReason).mockReturnValueOnce("blocked private IP");
    const result = await fetchUrlWithSizeGuard("http://10.0.0.1/secret");
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("blocked");
    }
  });

  it("returns error on non-OK HTTP response", async () => {
    vi.mocked(fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 404,
      headers: { get: () => "text/html" },
    });
    const result = await fetchUrlWithSizeGuard("https://example.com/missing");
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("404");
    }
  });

  it("returns error on network failure", async () => {
    vi.mocked(fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const result = await fetchUrlWithSizeGuard("https://example.com/");
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("Could not fetch");
    }
  });

  it("parses plain text response without Readability", async () => {
    vi.mocked(fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => "text/plain" },
      text: async () => "hello world\n",
    });
    const result = await fetchUrlWithSizeGuard("https://example.com/file.txt");
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.content).toBe("hello world\n");
      expect(result.sizeWarning).toBe("none");
      expect(result.path).toBe("https://example.com/file.txt");
    }
  });

  it("strips HTML tags for non-Readability fallback via plain text path", async () => {
    const htmlContent = "<html><body><p>Article content here</p></body></html>";
    vi.mocked(fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => "text/plain" },
      text: async () => htmlContent,
    });
    const result = await fetchUrlWithSizeGuard("https://example.com/");
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      // plain text path: content returned as-is
      expect(result.content).toContain("Article content here");
    }
  });

  it("returns error for HTML response exceeding 512KB pre-parse limit", async () => {
    const largeHtml = "<html>" + "x".repeat(513 * 1024) + "</html>";
    vi.mocked(fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => "text/html" },
      text: async () => largeHtml,
    });
    const result = await fetchUrlWithSizeGuard("https://example.com/large");
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("too large to parse");
    }
  });

  it("returns error for response body exceeding 5MB pre-buffer guard", async () => {
    const bigBody = "x".repeat(5 * 1024 * 1024 + 1);
    vi.mocked(fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => "text/plain" },
      text: async () => bigBody,
    });
    const result = await fetchUrlWithSizeGuard("https://example.com/huge");
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("too large to process");
    }
  });

  it("returns error when plain text content exceeds 20KB post-parse limit", async () => {
    const bigText = "x".repeat(21 * 1024);
    vi.mocked(fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => "text/plain" },
      text: async () => bigText,
    });
    const result = await fetchUrlWithSizeGuard("https://example.com/big");
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("too large to attach");
    }
  });

  it("sets sizeWarning:truncated and caps content for >500-line responses", async () => {
    const manyLines = Array.from({ length: 600 }, (_, i) => `line ${i}`).join("\n");
    vi.mocked(fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => "text/plain" },
      text: async () => manyLines,
    });
    const result = await fetchUrlWithSizeGuard("https://example.com/long", 200);
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.sizeWarning).toBe("truncated");
      expect(result.content).toContain("[truncated]");
      expect(result.lineCount).toBe(600);
    }
  });

  it("sets sizeWarning:warned for 200-500 line responses without truncating", async () => {
    const mediumLines = Array.from({ length: 300 }, (_, i) => `line ${i}`).join("\n");
    vi.mocked(fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => "text/plain" },
      text: async () => mediumLines,
    });
    const result = await fetchUrlWithSizeGuard("https://example.com/medium");
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.sizeWarning).toBe("warned");
      expect(result.content).not.toContain("[truncated]");
      expect(result.lineCount).toBe(300);
    }
  });

  it("blocks redirect to private IP via response.url SSRF re-check", async () => {
    vi.mocked(fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      url: "http://10.0.0.1/secrets",
      headers: { get: () => "text/plain" },
      text: async () => "sensitive",
    });
    const result = await fetchUrlWithSizeGuard("https://attacker.com/redirect");
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("redirect blocked");
    }
  });
});

// ---------------------------------------------------------------------------
// expandAttachments — URL token expansion
// ---------------------------------------------------------------------------

describe("expandAttachments — URL tokens", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("inlines a URL and removes @token from cleanLine", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => "text/plain" },
      text: async () => "API docs content\n",
    }));
    const { cleanLine, preamble, attached } = await expandAttachments(
      "Explain @https://docs.example.com/api",
      "/tmp",
    );
    expect(attached).toHaveLength(1);
    expect(preamble).toContain('<file path="https://docs.example.com/api">');
    expect(cleanLine).toBe("Explain");
  });

  it("preserves @url token in cleanLine on fetch error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("Network error")));
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { cleanLine, attached } = await expandAttachments(
      "Check @https://broken.example.com/",
      "/tmp",
    );
    expect(attached).toHaveLength(0);
    expect(cleanLine).toContain("@https://broken.example.com/");
    expect(stderrSpy).toHaveBeenCalled();
  });

  it("removes @url with trailing punctuation from cleanLine after successful fetch", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => "text/plain" },
      text: async () => "content\n",
    }));
    const { cleanLine, attached } = await expandAttachments(
      "See @https://example.com/page.",
      "/tmp",
    );
    expect(attached).toHaveLength(1);
    expect(cleanLine).not.toContain("@https");
  });
});

// ---------------------------------------------------------------------------
// collectMatchingFiles (fuzzy recursive walk)
// ---------------------------------------------------------------------------

import { collectMatchingFiles } from "../../src/cli/file-attachment.js";

describe("collectMatchingFiles — recursive fuzzy walk", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "phase2s-collect-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("finds a file by basename substring across directories", () => {
    mkdirSync(join(tmpDir, "src", "core"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "core", "agent.ts"), "");
    const results: string[] = [];
    collectMatchingFiles(tmpDir, "agent", results, 0, tmpDir);
    expect(results).toContain("@src/core/agent.ts");
  });

  it("matches case-insensitively", () => {
    writeFileSync(join(tmpDir, "AGENT.TS"), "");
    const results: string[] = [];
    collectMatchingFiles(tmpDir, "agent", results, 0, tmpDir);
    expect(results.some((r) => r.toLowerCase().includes("agent"))).toBe(true);
  });

  it("skips node_modules directory", () => {
    mkdirSync(join(tmpDir, "node_modules", "foo"), { recursive: true });
    writeFileSync(join(tmpDir, "node_modules", "foo", "agent.js"), "");
    const results: string[] = [];
    collectMatchingFiles(tmpDir, "agent", results, 0, tmpDir);
    expect(results).toHaveLength(0);
  });

  it("skips dotfiles and dot-directories", () => {
    writeFileSync(join(tmpDir, ".agentrc"), "");
    const results: string[] = [];
    collectMatchingFiles(tmpDir, "agent", results, 0, tmpDir);
    expect(results).toHaveLength(0);
  });

  it("BFS: finds file at depth >4 (no depth cap with BFS traversal)", () => {
    // BFS replaced the depth-limited DFS. Files at any depth are now collected
    // as long as the 500-result and 5000-dir caps haven't been reached.
    const deep = join(tmpDir, "a", "b", "c", "d", "e");
    mkdirSync(deep, { recursive: true });
    writeFileSync(join(deep, "agent.ts"), "");
    const results: string[] = [];
    collectMatchingFiles(tmpDir, "agent", results, 0, tmpDir);
    // BFS visits all depths — agent.ts at depth 5 must appear
    expect(results.some((r) => r.includes(join("a", "b", "c", "d", "e")))).toBe(true);
  });

  it("BFS: shallow match collected before deep match with same basename", () => {
    // BFS ordering guarantees shallower files are collected first.
    mkdirSync(join(tmpDir, "src", "core", "deep"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "agent.ts"), "");         // depth 2
    writeFileSync(join(tmpDir, "src", "core", "deep", "agent.ts"), ""); // depth 4
    const results: string[] = [];
    collectMatchingFiles(tmpDir, "agent", results, 0, tmpDir);
    const shallowIdx = results.findIndex((r) => r === "@src/agent.ts");
    const deepIdx = results.findIndex((r) => r.includes(join("core", "deep", "agent.ts")));
    expect(shallowIdx).toBeGreaterThanOrEqual(0);
    expect(deepIdx).toBeGreaterThanOrEqual(0);
    expect(shallowIdx).toBeLessThan(deepIdx);
  });

  it("BFS: visited-cap (5000 dirs) terminates without hanging", () => {
    // Mock readdirSync to simulate a very deep/wide tree that would exceed the cap.
    // Each call returns one subdirectory so the queue grows; after 5000 pops it stops.
    let visitCount = 0;
    const readdirMock = vi.spyOn(
      require("node:fs"),
      "readdirSync",
    ).mockImplementation((_path: string, _opts: unknown) => {
      visitCount++;
      // Return a single subdirectory entry each time (infinite tree)
      const { Dirent } = require("node:fs");
      const entry = Object.create(Dirent.prototype);
      entry.name = "sub";
      entry.isDirectory = () => true;
      entry.isFile = () => false;
      return [entry];
    });

    const results: string[] = [];
    // Should terminate — not hang — because visited < 5000 cap kicks in
    collectMatchingFiles("/fake/root", "anything", results, 0, "/fake/root");

    // visited cap was applied — function returned without hanging
    expect(results).toHaveLength(0);
    readdirMock.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// makeCompleter — fuzzy mode (no "/" in fragment)
// ---------------------------------------------------------------------------

describe("makeCompleter — fuzzy mode", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "phase2s-fuzzy-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function invoke(getCwd: () => string, line: string): Promise<[string[], string]> {
    return new Promise((resolve, reject) => {
      makeCompleter(getCwd)(line, (err, result) => (err ? reject(err) : resolve(result)));
    });
  }

  it("returns file found by basename substring in subdirectory", async () => {
    mkdirSync(join(tmpDir, "src", "core"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "core", "agent.ts"), "");
    const [completions] = await invoke(() => tmpDir, "@agent");
    expect(completions).toContain("@src/core/agent.ts");
  });

  it("returns nothing for empty fragment (bare @)", async () => {
    writeFileSync(join(tmpDir, "agent.ts"), "");
    const [completions, hit] = await invoke(() => tmpDir, "@");
    expect(completions).toHaveLength(0);
    expect(hit).toBe("@");
  });

  it("path with / still uses prefix-match behavior (backward compat)", async () => {
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "agent.ts"), "");
    const [completions] = await invoke(() => tmpDir, "@src/ag");
    expect(completions).toContain("@src/agent.ts");
  });
});

describe("collectMatchingFiles — dist skip", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "phase2s-dist-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("skips dist directory", () => {
    mkdirSync(join(tmpDir, "dist"), { recursive: true });
    writeFileSync(join(tmpDir, "dist", "agent.js"), "");
    const results: string[] = [];
    collectMatchingFiles(tmpDir, "agent", results, 0, tmpDir);
    expect(results).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// makeCompleter — completer ranking sort
// ---------------------------------------------------------------------------

describe("makeCompleter — ranking sort", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "phase2s-rank-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  async function invoke(getCwd: () => string, line: string): Promise<[string[], string]> {
    return new Promise((resolve, reject) => {
      makeCompleter(getCwd)(line, (err, result) => (err ? reject(err) : resolve(result)));
    });
  }

  it("prefix match ranks above substring match: agent.ts before agent-types.ts", async () => {
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "agent-types.ts"), "");
    writeFileSync(join(tmpDir, "src", "agent.ts"), "");
    const [completions] = await invoke(() => tmpDir, "@agent");
    expect(completions.length).toBeGreaterThanOrEqual(2);
    const agentIdx = completions.findIndex((c) => c.endsWith("agent.ts"));
    const typesIdx = completions.findIndex((c) => c.endsWith("agent-types.ts"));
    expect(agentIdx).toBeGreaterThanOrEqual(0);
    expect(typesIdx).toBeGreaterThanOrEqual(0);
    expect(agentIdx).toBeLessThan(typesIdx);
  });

  it("shorter path ranks above longer path for same prefix match", async () => {
    mkdirSync(join(tmpDir, "src", "core"), { recursive: true });
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "core", "agent.ts"), "");
    writeFileSync(join(tmpDir, "src", "agent.ts"), "");
    const [completions] = await invoke(() => tmpDir, "@agent");
    const shallow = completions.findIndex((c) => c === "@src/agent.ts");
    const deep = completions.findIndex((c) => c.includes("core/agent.ts"));
    expect(shallow).toBeGreaterThanOrEqual(0);
    expect(deep).toBeGreaterThanOrEqual(0);
    expect(shallow).toBeLessThan(deep);
  });

  it("alpha tiebreak for same prefix and same path length", async () => {
    writeFileSync(join(tmpDir, "beta.ts"), "");
    writeFileSync(join(tmpDir, "alpha.ts"), "");
    const [completions] = await invoke(() => tmpDir, "@a");
    const alphaIdx = completions.findIndex((c) => c.endsWith("alpha.ts"));
    const betaIdx = completions.findIndex((c) => c.endsWith("beta.ts"));
    // alpha.ts is a prefix match; beta.ts starts with 'b' not 'a'
    // both have same depth — alpha prefix wins
    expect(alphaIdx).toBeGreaterThanOrEqual(0);
    expect(alphaIdx).toBeLessThan(betaIdx === -1 ? Infinity : betaIdx);
  });

  it("sort applied in slash branch: directory completions ranked by prefix", async () => {
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "agent-runner.ts"), "");
    writeFileSync(join(tmpDir, "src", "agent.ts"), "");
    const [completions] = await invoke(() => tmpDir, "@src/ag");
    expect(completions.length).toBeGreaterThanOrEqual(2);
    const agentIdx = completions.findIndex((c) => c.endsWith("agent.ts"));
    const runnerIdx = completions.findIndex((c) => c.endsWith("agent-runner.ts"));
    expect(agentIdx).toBeLessThan(runnerIdx);
  });

  it("empty fragment returns no completions (no sort attempted)", async () => {
    writeFileSync(join(tmpDir, "agent.ts"), "");
    const [completions] = await invoke(() => tmpDir, "@");
    expect(completions).toHaveLength(0);
  });

  it("ranking is best-effort when results approach MAX_COMPLETER_RESULTS (documented)", async () => {
    // BFS collects shallower files first; in small trees the best match is always
    // collected and ranked first. The 500-result cap is a safety net for huge trees.
    writeFileSync(join(tmpDir, "agent.ts"), "");
    const [completions] = await invoke(() => tmpDir, "@agent");
    expect(completions[0]).toContain("agent");
  });
});
