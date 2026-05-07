import { describe, it, expect } from "vitest";
import { buildCodeContextBlock } from "../../src/core/code-context.js";
import type { CodeSearchResult } from "../../src/core/code-index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResult(overrides: Partial<CodeSearchResult> = {}): CodeSearchResult {
  return {
    path: "src/core/agent.ts",
    chunkName: "runOnce",
    chunkStart: 10,
    chunkEnd: 30,
    score: 0.812,
    snippet: "function runOnce() {}",
    ...overrides,
  };
}

describe("buildCodeContextBlock", () => {
  it("returns null for empty results array", () => {
    expect(buildCodeContextBlock([])).toBeNull();
  });

  it("includes path, chunkName, score formatted to 3 decimals, and snippet in backtick block", () => {
    const result = makeResult();
    const block = buildCodeContextBlock([result]);
    expect(block).not.toBeNull();
    expect(block).toContain("src/core/agent.ts");
    expect(block).toContain("runOnce");
    expect(block).toContain("0.812");
    expect(block).toContain("```\nfunction runOnce() {}\n```");
  });

  it("does not add truncation marker when snippet is exactly 25 lines", () => {
    const lines = Array.from({ length: 25 }, (_, i) => `line ${i + 1}`);
    const snippet = lines.join("\n");
    const block = buildCodeContextBlock([makeResult({ snippet })]);
    expect(block).toContain(snippet);
    expect(block).not.toContain("more lines");
  });

  // Note: snippet truncation happens in searchCode() before reaching this function.
  // buildCodeContextBlock() renders whatever snippet it receives verbatim.
  // This test verifies the truncation marker surfaced by searchCode() passes through.
  it("renders a snippet that already contains a truncation marker from searchCode", () => {
    const truncated = Array.from({ length: 25 }, (_, i) => `line ${i + 1}`).join("\n") + "\n// ...3 more lines";
    const block = buildCodeContextBlock([makeResult({ snippet: truncated })]);
    expect(block).toContain("// ...3 more lines");
  });

  it("omits chunkName parenthetical when chunkName is absent", () => {
    const result = makeResult({ chunkName: undefined });
    const block = buildCodeContextBlock([result]);
    expect(block).not.toContain("(undefined)");
    expect(block).not.toMatch(/\(\w+\)/); // no parenthetical at all
    expect(block).toContain("src/core/agent.ts");
  });

  it("renders (no snippet) when snippet is empty string", () => {
    const result = makeResult({ snippet: "", chunkName: undefined });
    const block = buildCodeContextBlock([result]);
    expect(block).toContain("(no snippet)");
    expect(block).not.toContain("```");
  });

  it("includes [1], [2], [3] headers for multiple results", () => {
    const results = [
      makeResult({ path: "a.ts", score: 0.9 }),
      makeResult({ path: "b.ts", score: 0.8 }),
      makeResult({ path: "c.ts", score: 0.7 }),
    ];
    const block = buildCodeContextBlock(results);
    expect(block).toContain("[1]");
    expect(block).toContain("[2]");
    expect(block).toContain("[3]");
    expect(block).toContain("a.ts");
    expect(block).toContain("b.ts");
    expect(block).toContain("c.ts");
  });
});
