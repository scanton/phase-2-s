import { describe, it, expect } from "vitest";
import { computeConductStats } from "../../src/cli/conduct-insights.js";
import type { ConductLogEntry } from "../../src/cli/conduct-log.js";

function makeEntry(overrides: Partial<ConductLogEntry> = {}): ConductLogEntry {
  return {
    ts: new Date().toISOString(),
    goal: "add user authentication",
    specPath: "/tmp/spec.md",
    specHash: "abc12345",
    subtaskCount: 4,
    roles: ["backend", "security"],
    success: true,
    durationMs: 30000,
    runLogPath: "/tmp/run.jsonl",
    rounds: 0,
    ...overrides,
  };
}

describe("computeConductStats()", () => {
  it("returns zero stats for empty array", () => {
    const stats = computeConductStats([]);
    expect(stats.totalRuns).toBe(0);
    expect(stats.successCount).toBe(0);
    expect(stats.successRate).toBe(0);
    expect(stats.avgDurationMs).toBe(0);
    expect(stats.dryRunCount).toBe(0);
    expect(stats.topRoles).toEqual([]);
    expect(stats.recentGoals).toEqual([]);
  });

  it("counts total runs excluding dry-runs", () => {
    const entries = [
      makeEntry({ success: true }),
      makeEntry({ success: false }),
      makeEntry({ dryRun: true, success: false }),
    ];
    const stats = computeConductStats(entries);
    expect(stats.totalRuns).toBe(2);
    expect(stats.dryRunCount).toBe(1);
  });

  it("computes correct success rate", () => {
    const entries = [
      makeEntry({ success: true }),
      makeEntry({ success: true }),
      makeEntry({ success: false }),
    ];
    const stats = computeConductStats(entries);
    expect(stats.successCount).toBe(2);
    expect(stats.successRate).toBeCloseTo(2 / 3);
  });

  it("dry-run entries do not affect success rate", () => {
    const entries = [
      makeEntry({ success: true }),
      makeEntry({ success: true }),
      makeEntry({ dryRun: true, success: false }), // should be excluded
    ];
    const stats = computeConductStats(entries);
    expect(stats.successRate).toBe(1.0);
  });

  it("computes average duration in ms (excluding dry-runs)", () => {
    const entries = [
      makeEntry({ durationMs: 10000, success: true }),
      makeEntry({ durationMs: 20000, success: true }),
      makeEntry({ dryRun: true, durationMs: 999999, success: false }), // excluded
    ];
    const stats = computeConductStats(entries);
    expect(stats.avgDurationMs).toBe(15000);
  });

  it("computes subtask min / median / max (excluding dry-runs)", () => {
    const entries = [
      makeEntry({ subtaskCount: 2, success: true }),
      makeEntry({ subtaskCount: 4, success: true }),
      makeEntry({ subtaskCount: 8, success: true }),
      makeEntry({ dryRun: true, subtaskCount: 100, success: false }), // excluded
    ];
    const stats = computeConductStats(entries);
    expect(stats.subtaskMin).toBe(2);
    expect(stats.subtaskMax).toBe(8);
    expect(stats.subtaskMedian).toBe(4);
  });

  it("builds refinement round histogram including all entries", () => {
    const entries = [
      makeEntry({ rounds: 0 }),
      makeEntry({ rounds: 0 }),
      makeEntry({ rounds: 1 }),
      makeEntry({ rounds: 3 }),
      makeEntry({ dryRun: true, rounds: 2 }), // dry-runs are included in histogram
    ];
    const stats = computeConductStats(entries);
    expect(stats.roundHistogram["0"]).toBe(2);
    expect(stats.roundHistogram["1"]).toBe(1);
    expect(stats.roundHistogram["2"]).toBe(1);
    expect(stats.roundHistogram["3"]).toBe(1);
  });

  it("caps histogram bucket at 3 for rounds > 3", () => {
    const entries = [makeEntry({ rounds: 99, success: true })];
    const stats = computeConductStats(entries);
    expect(stats.roundHistogram["3"]).toBe(1);
  });

  it("ranks top roles by frequency (excluding dry-runs)", () => {
    const entries = [
      makeEntry({ roles: ["backend", "security"], success: true }),
      makeEntry({ roles: ["backend", "frontend"], success: true }),
      makeEntry({ roles: ["backend"], success: true }),
      makeEntry({ dryRun: true, roles: ["frontend", "backend"], success: false }), // excluded
    ];
    const stats = computeConductStats(entries);
    expect(stats.topRoles[0].role).toBe("backend"); // appears 3 times
    expect(stats.topRoles[0].count).toBe(3);
  });

  it("caps top roles at 5", () => {
    const entries = Array.from({ length: 10 }, (_, i) =>
      makeEntry({ roles: [`role${i}`], success: true }),
    );
    const stats = computeConductStats(entries);
    expect(stats.topRoles).toHaveLength(5);
  });

  it("returns last 5 goals with outcome (newest first)", () => {
    const entries = Array.from({ length: 7 }, (_, i) =>
      makeEntry({ goal: `goal ${i}`, ts: `2024-01-0${i + 1}T00:00:00Z`, success: i % 2 === 0 }),
    );
    // entries are stored newest-first by readConductLog — we receive them that way
    const stats = computeConductStats(entries);
    expect(stats.recentGoals).toHaveLength(5);
    expect(stats.recentGoals[0].goalSnippet).toBe("goal 0");
  });

  it("truncates goal snippets to 60 characters", () => {
    const longGoal = "a".repeat(100);
    const stats = computeConductStats([makeEntry({ goal: longGoal, success: true })]);
    expect(stats.recentGoals[0].goalSnippet).toHaveLength(60);
  });
});
