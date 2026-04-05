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

  it("all full poses are 7 lines (fixed-frame bear face)", async () => {
    const { fullPoses } = await import("../../src/bear/art.js");
    for (const [state, art] of Object.entries(fullPoses)) {
      const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
      const lines = stripAnsi(art).split("\n");
      expect(lines.length, `${state} should be 7 lines`).toBe(7);
    }
  });

  it("all poses share the same fixed frame (ears, forehead, nose, chin)", async () => {
    const { fullPoses } = await import("../../src/bear/art.js");
    const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
    const poses = Object.values(fullPoses).map((art) => stripAnsi(art).split("\n"));
    // Lines 0-2 (ears + forehead), line 4 (nose), line 6 (chin) should be identical
    for (let i = 1; i < poses.length; i++) {
      expect(poses[i][0]).toBe(poses[0][0]); // ear tips
      expect(poses[i][1]).toBe(poses[0][1]); // ear curves
      expect(poses[i][2]).toBe(poses[0][2]); // forehead
      expect(poses[i][4]).toBe(poses[0][4]); // nose
      expect(poses[i][6]).toBe(poses[0][6]); // chin
    }
  });

  it("bear has ears (underscore characters on line 1)", async () => {
    const { fullPoses } = await import("../../src/bear/art.js");
    const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
    const firstLine = stripAnsi(fullPoses.greeting).split("\n")[0];
    expect(firstLine).toContain("_");
  });

  it("bear has a nose with (_) on line 5", async () => {
    const { fullPoses } = await import("../../src/bear/art.js");
    const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
    const noseLine = stripAnsi(fullPoses.greeting).split("\n")[4];
    expect(noseLine).toContain("(_)");
  });

  it("help pose has pointing mouth (> >)", async () => {
    const { fullPoses } = await import("../../src/bear/art.js");
    const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
    expect(stripAnsi(fullPoses.help)).toContain("> >");
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
    const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
    const art = getBearArt(BearState.greeting, false);
    expect(stripAnsi(art).split("\n").length).toBe(7);
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
