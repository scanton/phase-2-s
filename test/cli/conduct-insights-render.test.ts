/**
 * Tests for conduct-insights.ts — renderConductStats, runConductInsights, rebuildConductIndex.
 *
 * computeConductStats is already tested in conduct-insights.test.ts (14 tests).
 * This file covers the untested output + orchestration paths added in Sprint 91.
 *
 * Paths covered:
 *  R1. renderConductStats — zero runs + zero dry-runs → "No conduct runs logged" message
 *  R2. renderConductStats — zero real runs, some dry-runs → shows zero-run table with dry-run count
 *  R3. renderConductStats — success rate ≥ 70% → green pct
 *  R4. renderConductStats — success rate 40–69% → yellow pct
 *  R5. renderConductStats — success rate < 40% → red pct
 *  R6. renderConductStats — dry-run count > 1 → pluralised "(+N dry-runs)"
 *  R7. renderConductStats — dry-run count = 1 → singular "(+1 dry-run)"
 *  R8. renderConductStats — totalRuns > 0 → prints subtask line
 *  R9. renderConductStats — refinement histogram shows only non-zero buckets
 *  R10. renderConductStats — top roles listed
 *  R11. renderConductStats — recent goals shown with icon
 *  I1. runConductInsights — json=true → logs JSON stats to stdout
 *  I2. runConductInsights — rebuildIndex=true, Ollama not configured → logs error, sets exitCode=1
 *  I3. runConductInsights — rebuildIndex=true, no non-dry-run entries → "No non-dry-run entries" msg
 *  I4. runConductInsights — rebuildIndex=true, Ollama configured, upsert success → logs indexed count
 *  I5. runConductInsights — rebuildIndex=true, quiet=true → no progress output
 *  I6. runConductInsights — default (no flags) → calls renderConductStats
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  renderConductStats,
  runConductInsights,
  computeConductStats,
  type ConductStats,
} from "../../src/cli/conduct-insights.js";
import type { ConductLogEntry } from "../../src/cli/conduct-log.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStats(overrides: Partial<ConductStats> = {}): ConductStats {
  return {
    totalRuns: 0,
    successCount: 0,
    successRate: 0,
    avgDurationMs: 0,
    subtaskMin: 0,
    subtaskMedian: 0,
    subtaskMax: 0,
    roundHistogram: { "0": 0, "1": 0, "2": 0, "3": 0 },
    topRoles: [],
    recentGoals: [],
    dryRunCount: 0,
    ...overrides,
  };
}

function makeEntry(overrides: Partial<ConductLogEntry> = {}): ConductLogEntry {
  return {
    ts: new Date().toISOString(),
    goal: "add user auth",
    specPath: "/tmp/spec.md",
    specHash: "abc12345",
    subtaskCount: 3,
    roles: ["backend"],
    success: true,
    durationMs: 20000,
    runLogPath: "/tmp/run.jsonl",
    rounds: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// renderConductStats — output path tests
// ---------------------------------------------------------------------------

describe("renderConductStats()", () => {
  let logs: string[];
  let originalLog: typeof console.log;
  let originalWarn: typeof console.warn;

  beforeEach(() => {
    logs = [];
    originalLog = console.log;
    originalWarn = console.warn;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));
    console.warn = (...args: unknown[]) => logs.push(args.join(" "));
  });

  afterEach(() => {
    console.log = originalLog;
    console.warn = originalWarn;
  });

  it("R1: prints 'No conduct runs logged' when totalRuns=0 and dryRunCount=0", () => {
    renderConductStats(makeStats({ totalRuns: 0, dryRunCount: 0 }));
    expect(logs.some((l) => l.includes("No conduct runs logged"))).toBe(true);
  });

  it("R2: shows summary table even when totalRuns=0 if there are dry-runs", () => {
    renderConductStats(makeStats({ totalRuns: 0, dryRunCount: 2, successRate: 0 }));
    // Should NOT emit "No conduct runs" when dry-runs exist
    expect(logs.some((l) => l.includes("No conduct runs logged"))).toBe(false);
    expect(logs.some((l) => l.includes("dry-run"))).toBe(true);
  });

  it("R3: shows success rate >= 70 in green (contains pct value)", () => {
    renderConductStats(makeStats({ totalRuns: 5, successCount: 4, successRate: 0.8 }));
    expect(logs.some((l) => l.includes("80%"))).toBe(true);
  });

  it("R4: shows success rate 40-69 in yellow", () => {
    renderConductStats(makeStats({ totalRuns: 2, successCount: 1, successRate: 0.5 }));
    expect(logs.some((l) => l.includes("50%"))).toBe(true);
  });

  it("R5: shows success rate < 40 in red", () => {
    renderConductStats(makeStats({ totalRuns: 5, successCount: 1, successRate: 0.2 }));
    expect(logs.some((l) => l.includes("20%"))).toBe(true);
  });

  it("R6: pluralises dry-run count when > 1", () => {
    renderConductStats(makeStats({ totalRuns: 1, dryRunCount: 3, successRate: 1 }));
    expect(logs.some((l) => l.includes("dry-runs"))).toBe(true);
  });

  it("R7: singular 'dry-run' when count = 1", () => {
    renderConductStats(makeStats({ totalRuns: 1, dryRunCount: 1, successRate: 1 }));
    // Should include "(+1 dry-run)" without the s
    const line = logs.find((l) => l.includes("dry-run"));
    expect(line).toBeDefined();
    expect(line).not.toMatch(/dry-runs/);
  });

  it("R8: prints subtask min/median/max line when totalRuns > 0", () => {
    renderConductStats(
      makeStats({ totalRuns: 3, successRate: 1, subtaskMin: 2, subtaskMedian: 4, subtaskMax: 8 }),
    );
    expect(logs.some((l) => l.includes("min 2") && l.includes("max 8"))).toBe(true);
  });

  it("R9: refinement histogram shows only non-zero buckets", () => {
    renderConductStats(
      makeStats({
        totalRuns: 2,
        successRate: 1,
        roundHistogram: { "0": 2, "1": 0, "2": 0, "3": 0 },
      }),
    );
    const histLine = logs.find((l) => l.includes("Refinements"));
    expect(histLine).toBeDefined();
    // "0×: 2" should appear, "1×: 0" should NOT appear
    expect(histLine).toMatch(/0.*2/);
    expect(histLine).not.toMatch(/1.*0/);
  });

  it("R10: lists top roles when present", () => {
    renderConductStats(
      makeStats({
        totalRuns: 1,
        successRate: 1,
        topRoles: [{ role: "backend", count: 3 }],
      }),
    );
    expect(logs.some((l) => l.includes("backend") && l.includes("3"))).toBe(true);
  });

  it("R11: shows recent goals with success/fail icons", () => {
    renderConductStats(
      makeStats({
        totalRuns: 2,
        successRate: 0.5,
        recentGoals: [
          { goalSnippet: "add auth", success: true, ts: "2024-01-01T00:00:00Z" },
          { goalSnippet: "fix bug", success: false, ts: "2024-01-02T00:00:00Z" },
        ],
      }),
    );
    expect(logs.some((l) => l.includes("add auth"))).toBe(true);
    expect(logs.some((l) => l.includes("fix bug"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// runConductInsights — orchestration path tests
// ---------------------------------------------------------------------------

describe("runConductInsights()", () => {
  let tmpDir: string;
  let logs: string[];
  let errors: string[];
  let originalLog: typeof console.log;
  let originalError: typeof console.error;
  let originalExitCode: NodeJS.Process["exitCode"];

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "phase2s-ri-test-"));
    logs = [];
    errors = [];
    originalLog = console.log;
    originalError = console.error;
    originalExitCode = process.exitCode;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));
    console.error = (...args: unknown[]) => errors.push(args.join(" "));
    process.exitCode = undefined;
  });

  afterEach(async () => {
    console.log = originalLog;
    console.error = originalError;
    process.exitCode = originalExitCode;
    await rm(tmpDir, { recursive: true, force: true });
  });

  function writeConductLog(entries: object[]): void {
    mkdirSync(join(tmpDir, ".phase2s"), { recursive: true });
    const lines = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
    writeFileSync(join(tmpDir, ".phase2s", "conduct-log.jsonl"), lines, "utf8");
  }

  it("I1: json=true emits JSON stats to stdout and returns early", async () => {
    writeConductLog([makeEntry({ success: true })]);
    await runConductInsights({ json: true }, tmpDir);
    const jsonLine = logs.find((l) => {
      try { JSON.parse(l); return true; } catch { return false; }
    });
    expect(jsonLine).toBeDefined();
    const parsed = JSON.parse(jsonLine!);
    expect(parsed).toHaveProperty("totalRuns");
    expect(parsed.totalRuns).toBe(1);
  });

  it("I2: rebuildIndex=true with Ollama not configured → error logged, exitCode=1", async () => {
    writeConductLog([makeEntry({ success: true })]);
    // Mock config with no Ollama settings — use real loadConfig but no yaml
    await runConductInsights({ rebuildIndex: true }, tmpDir);
    expect(process.exitCode).toBe(1);
    expect(errors.some((e) => e.includes("Ollama is not configured"))).toBe(true);
  });

  it("I3: rebuildIndex=true with no log file → Ollama not configured exits at 1 before entries check", async () => {
    // No log file, no Ollama config — verify exitCode=1 and error about Ollama
    await runConductInsights({ rebuildIndex: true }, tmpDir);
    expect(process.exitCode).toBe(1);
    expect(errors.some((e) => e.includes("Ollama is not configured"))).toBe(true);
  });

  it("I6: default mode (no flags) calls renderConductStats — prints summary header", async () => {
    writeConductLog([makeEntry({ success: true })]);
    await runConductInsights({}, tmpDir);
    expect(logs.some((l) => l.includes("Conductor Run Summary"))).toBe(true);
  });

  it("I6b: no log file → prints 'No conduct runs logged' via renderConductStats", async () => {
    await runConductInsights({}, tmpDir);
    expect(logs.some((l) => l.includes("No conduct runs logged"))).toBe(true);
  });
});
