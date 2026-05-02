/**
 * Structural test: verifies the REPL :commit handler does not create
 * additional readline interfaces (rl2/rl3). After the Sprint 76 fix, the
 * handler calls ask(rl, ...) on the main REPL readline directly.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const indexSrc = readFileSync(
  join(import.meta.dirname, "../../src/cli/index.ts"),
  "utf8",
);

// Extract the :commit handler block: from the 'if (cleanLine === ":commit"' line
// to the matching 'continue;' that closes it.
function extractCommitBlock(src: string): string {
  const start = src.indexOf('if (cleanLine === ":commit"');
  if (start === -1) throw new Error("Could not find :commit handler in index.ts");
  // Walk forward to find the closing `continue;` at the same indent level
  // (simplistic: just grab enough lines to cover the handler)
  return src.slice(start, start + 5000);
}

const commitBlock = extractCommitBlock(indexSrc);

describe(":commit handler readline isolation", () => {
  it("does not call makeRl() inside the :commit handler", () => {
    expect(commitBlock).not.toContain("makeRl()");
  });

  it("does not call createRl() inside the :commit handler", () => {
    expect(commitBlock).not.toContain("createRl()");
  });

  it("does not create a new readline Interface inside the :commit handler", () => {
    expect(commitBlock).not.toContain("createInterface(");
  });

  it("uses rl.removeListener('line', onLine) before each prompt", () => {
    const matches = commitBlock.match(/rl\.removeListener\("line",\s*onLine\)/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });

  it("restores rl.on('line', onLine) in a finally block after each prompt", () => {
    const matches = commitBlock.match(/rl\.on\("line",\s*onLine\)/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });
});

describe("per-turn learnings DX indicator", () => {
  it("log.dim for 'learnings refreshed' is emitted after refreshLearnings", () => {
    // Verify the indicator exists immediately after the refreshLearnings call.
    const refreshIdx = indexSrc.indexOf("agent.refreshLearnings(turnLearningsStr)");
    expect(refreshIdx).toBeGreaterThan(-1);
    // The log.dim call should appear within 200 chars after refreshLearnings
    const after = indexSrc.slice(refreshIdx, refreshIdx + 200);
    expect(after).toContain("↻ learnings refreshed");
    expect(after).toContain("log.dim");
  });

  it("message uses correct entry/entries pluralization", () => {
    const idx = indexSrc.indexOf("↻ learnings refreshed");
    expect(idx).toBeGreaterThan(-1);
    const fragment = indexSrc.slice(idx, idx + 120);
    expect(fragment).toContain('"entry"');
    expect(fragment).toContain('"entries"');
  });
});
