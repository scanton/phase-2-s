import { describe, it, expect, beforeAll, afterAll } from "vitest";
import chalk from "chalk";

// Pin chalk level for deterministic snapshot tests
let originalLevel: number;
beforeAll(() => { originalLevel = chalk.level; chalk.level = 1; });
afterAll(() => { chalk.level = originalLevel; });

describe("Bear art", () => {
  it("exports all 5 full poses", async () => {
    const { fullPoses } = await import("../../src/bear/art.js");
    expect(Object.keys(fullPoses)).toEqual(["greeting", "thinking", "success", "error", "help"]);
  });

  it("exports all 5 compact poses", async () => {
    const { compactPoses } = await import("../../src/bear/art.js");
    expect(Object.keys(compactPoses)).toEqual(["greeting", "thinking", "success", "error", "help"]);
  });

  it("greeting pose is multi-line (8+ lines)", async () => {
    const { fullPoses } = await import("../../src/bear/art.js");
    const lines = fullPoses.greeting.split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(8);
  });

  it("thinking pose is a single line", async () => {
    const { fullPoses } = await import("../../src/bear/art.js");
    expect(fullPoses.thinking.split("\n").length).toBe(1);
  });

  it("success pose is multi-line (8+ lines)", async () => {
    const { fullPoses } = await import("../../src/bear/art.js");
    const lines = fullPoses.success.split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(8);
  });

  it("error pose is multi-line (8+ lines)", async () => {
    const { fullPoses } = await import("../../src/bear/art.js");
    const lines = fullPoses.error.split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(8);
  });

  it("help pose includes pointing arm (==>)", async () => {
    const { fullPoses } = await import("../../src/bear/art.js");
    expect(fullPoses.help).toContain("==>");
  });

  it("compact poses are single-line", async () => {
    const { compactPoses } = await import("../../src/bear/art.js");
    for (const [_state, art] of Object.entries(compactPoses)) {
      expect(art.split("\n").length).toBe(1);
    }
  });

  it("getBearArt returns full pose when compact is false", async () => {
    const { getBearArt } = await import("../../src/bear/art.js");
    const { BearState } = await import("../../src/bear/types.js");
    const art = getBearArt(BearState.greeting, false);
    expect(art.split("\n").length).toBeGreaterThanOrEqual(8);
  });

  it("getBearArt returns compact pose when compact is true", async () => {
    const { getBearArt } = await import("../../src/bear/art.js");
    const { BearState } = await import("../../src/bear/types.js");
    const art = getBearArt(BearState.greeting, true);
    expect(art.split("\n").length).toBe(1);
  });

  describe("NO_COLOR legibility", () => {
    it("all full poses are non-empty with chalk.level=0", async () => {
      const savedLevel = chalk.level;
      chalk.level = 0;
      // Re-import to get uncolored versions
      const { getBearArt } = await import("../../src/bear/art.js");
      const { BearState } = await import("../../src/bear/types.js");
      for (const state of Object.values(BearState)) {
        const art = getBearArt(state, false);
        expect(art.length).toBeGreaterThan(0);
      }
      chalk.level = savedLevel;
    });
  });

  it("poses use only pure ASCII characters (no Unicode)", async () => {
    const { fullPoses } = await import("../../src/bear/art.js");
    // Strip ANSI escape codes, then check remaining chars are ASCII
    const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
    for (const [_state, art] of Object.entries(fullPoses)) {
      const stripped = stripAnsi(art);
      for (const char of stripped) {
        const code = char.charCodeAt(0);
        expect(code).toBeLessThanOrEqual(127);
      }
    }
  });
});
