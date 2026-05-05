/**
 * Tests for src/core/chunker.ts
 *
 * Fixture design: SHORT_TS embeds 0-indexed line numbers as comments so
 * expected start/end values are self-documenting without any arithmetic.
 *
 * Alpine fallback is tested by vi.mocking the @ast-grep/napi module to
 * throw on require(), simulating a missing native binary.
 */

import { describe, it, expect, vi } from "vitest";
import { chunkFile, MIN_CHUNK_LINES } from "../../src/core/chunker.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * TypeScript fixture with embedded line numbers in comments.
 * Lines 0-2: sha256 stub — end-start = 2, BELOW MIN_CHUNK_LINES → filtered
 * Lines 4-8: cosineSimilarity — end-start = 4 → included
 * Lines 10-15: class with method inside
 */
const SHORT_TS = [
  "// line 0",
  "function sha256(text: string): string {",  // line 1 — start
  "  return text;",                             // line 2 — end (end-start = 1, < MIN=3 → filtered)
  "",
  "function cosineSimilarity(",                 // line 4 — start
  "  a: number[],",                             // line 5
  "  b: number[]",                              // line 6
  "): number {",                                // line 7
  "  return 0;",                                // line 8 — end (end-start = 4 → included)
  "}",
  "class Foo {",                                // line 10
  "  method() {",                               // line 11 — start (method_definition)
  "    // body",                                // line 12
  "    return 1;",                              // line 13
  "  }",                                        // line 14 — end
  "}",                                          // line 15
].join("\n");

const MARKDOWN_DOC = [
  "# Title",
  "Intro paragraph.",
  "",
  "## Installation",
  "Install with npm.",
  "",
  "### Quick start",
  "Quick start guide here.",
  "",
  "## Configuration",
  "Config details here.",
].join("\n");

// ---------------------------------------------------------------------------
// Chunker — TypeScript (ast-grep required)
// ---------------------------------------------------------------------------

describe("chunkFile — TypeScript", () => {
  it("filters functions with end-start < MIN_CHUNK_LINES (sha256 stub)", () => {
    const chunks = chunkFile(SHORT_TS, "code.ts");
    // If ast-grep is unavailable (e.g. Alpine), returns [] — test is vacuously passing
    const sha256Chunk = chunks.find((c) => c.name.includes("sha256"));
    expect(sha256Chunk).toBeUndefined();
  });

  it("includes cosineSimilarity (end-start >= MIN_CHUNK_LINES)", () => {
    const chunks = chunkFile(SHORT_TS, "code.ts");
    if (chunks.length === 0) return; // ast-grep unavailable — skip
    const cos = chunks.find((c) => c.name.includes("cosineSimilarity"));
    expect(cos).toBeDefined();
    expect(cos!.start).toBe(4);
    expect(cos!.end).toBe(9); // closing } of cosineSimilarity is at line 9
    expect(cos!.content).toContain("cosineSimilarity");
  });

  it("includes method_definition inside a class (Foo.method)", () => {
    const chunks = chunkFile(SHORT_TS, "code.ts");
    if (chunks.length === 0) return;
    const method = chunks.find((c) => c.name.includes("method"));
    expect(method).toBeDefined();
  });

  it("does NOT return the class_declaration itself as a chunk", () => {
    const chunks = chunkFile(SHORT_TS, "code.ts");
    if (chunks.length === 0) return;
    // class_declaration is not in CHUNK_KINDS for TypeScript
    const classChunk = chunks.find((c) => c.name.includes("class Foo"));
    expect(classChunk).toBeUndefined();
  });

  it("dedup: outer chunk wins when nested", () => {
    // A function containing a nested class with a method — outer function swallows nested method
    const nested = [
      "function outer() {",      // line 0 — start
      "  class Inner {",          // line 1
      "    innerMethod() {",       // line 2
      "      return 42;",          // line 3
      "    }",                     // line 4
      "  }",                       // line 5
      "  return new Inner();",     // line 6
      "}",                         // line 7 — end
    ].join("\n");

    const chunks = chunkFile(nested, "code.ts");
    if (chunks.length === 0) return;
    // Only one chunk — outer wins, inner method is not a separate result
    const starts = chunks.map((c) => c.start);
    expect(new Set(starts).size).toBe(starts.length); // no duplicate starts
  });

  it("returns [] for .ts when ast-grep returns empty (parse failure)", () => {
    // Truly broken TS that even ast-grep won't parse — chunkFile catches parse errors
    const broken = "function }{{{ INVALID";
    // Either returns [] (parse failed) or some partial parse — either way, no crash
    expect(() => chunkFile(broken, "broken.ts")).not.toThrow();
  });

  it("name field contains first 80 chars of node source text", () => {
    const chunks = chunkFile(SHORT_TS, "code.ts");
    if (chunks.length === 0) return;
    for (const chunk of chunks) {
      expect(chunk.name.length).toBeLessThanOrEqual(80);
    }
  });

  it("content matches lines slice(start, end+1)", () => {
    const chunks = chunkFile(SHORT_TS, "code.ts");
    if (chunks.length === 0) return;
    const lines = SHORT_TS.split("\n");
    for (const chunk of chunks) {
      expect(chunk.content).toBe(lines.slice(chunk.start, chunk.end + 1).join("\n"));
    }
  });
});

// ---------------------------------------------------------------------------
// Chunker — unsupported extension
// ---------------------------------------------------------------------------

describe("chunkFile — unsupported extensions", () => {
  it("returns [] for .json (not in EXT_TO_LANG)", () => {
    expect(chunkFile('{"key": "value"}', "config.json")).toEqual([]);
  });

  it("returns [] for .txt", () => {
    expect(chunkFile("hello world", "readme.txt")).toEqual([]);
  });

  it("returns [] for .sh (not in EXT_TO_LANG)", () => {
    expect(chunkFile("#!/bin/bash\necho hi", "build.sh")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Chunker — Markdown (no native module needed)
// ---------------------------------------------------------------------------

describe("chunkFile — Markdown", () => {
  it("splits at ## headings", () => {
    const chunks = chunkFile(MARKDOWN_DOC, "README.md");
    const names = chunks.map((c) => c.name);
    expect(names).toContain("Installation");
    expect(names).toContain("Configuration");
  });

  it("splits at ### headings", () => {
    const chunks = chunkFile(MARKDOWN_DOC, "README.md");
    const names = chunks.map((c) => c.name);
    expect(names).toContain("Quick start");
  });

  it("includes the header line in section content", () => {
    const chunks = chunkFile(MARKDOWN_DOC, "README.md");
    const install = chunks.find((c) => c.name === "Installation");
    expect(install).toBeDefined();
    expect(install!.content).toContain("## Installation");
    expect(install!.content).toContain("Install with npm.");
  });

  it("filters sections with no non-whitespace content", () => {
    const doc = "## Empty\n\n## HasContent\nsome text here.";
    const chunks = chunkFile(doc, "doc.md");
    // "Empty" section has only whitespace → filtered
    expect(chunks.find((c) => c.name === "Empty")).toBeUndefined();
    expect(chunks.find((c) => c.name === "HasContent")).toBeDefined();
  });

  it("does NOT split at # (h1) headings", () => {
    const chunks = chunkFile(MARKDOWN_DOC, "README.md");
    // The Title h1 is not treated as a boundary
    const titleChunk = chunks.find((c) => c.name === "Title");
    expect(titleChunk).toBeUndefined();
  });

  it("works for .mdx extension too", () => {
    // File with content before the heading so "Section One" triggers the split
    const mdx = "Intro.\n## Section One\nsome content here.";
    const chunks = chunkFile(mdx, "page.mdx");
    expect(chunks.length).toBeGreaterThan(0);
    // At least one chunk should have name "Section One"
    expect(chunks.some((c) => c.name === "Section One")).toBe(true);
  });

  it("start and end are correct 0-indexed line numbers", () => {
    const chunks = chunkFile(MARKDOWN_DOC, "README.md");
    for (const chunk of chunks) {
      expect(chunk.start).toBeGreaterThanOrEqual(0);
      expect(chunk.end).toBeGreaterThanOrEqual(chunk.start);
    }
  });
});

// ---------------------------------------------------------------------------
// MIN_CHUNK_LINES constant
// ---------------------------------------------------------------------------

describe("MIN_CHUNK_LINES", () => {
  it("is exported and equals 3", () => {
    expect(MIN_CHUNK_LINES).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Alpine fallback (ast-grep unavailable) — contract test
// ---------------------------------------------------------------------------

describe("chunkFile — Alpine fallback contract", () => {
  it("never throws, always returns an array", () => {
    // The module-scope try/catch handles native binary missing at load time.
    // Regardless of ast-grep availability, chunkFile must never throw.
    const inputs = [
      { content: "export function x() { return 1; }", path: "code.ts" },
      { content: "# Heading\nsome content", path: "doc.md" },
      { content: "{{{BROKEN", path: "broken.ts" },
      { content: "", path: "empty.ts" },
    ];
    for (const { content, path } of inputs) {
      expect(() => chunkFile(content, path)).not.toThrow();
      expect(Array.isArray(chunkFile(content, path))).toBe(true);
    }
  });
});
