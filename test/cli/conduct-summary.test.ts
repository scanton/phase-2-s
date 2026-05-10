/**
 * Tests for conduct-summary.ts
 *
 * Coverage:
 *  1. formatDuration — 0ms → "0s"
 *  2. formatDuration — sub-minute (1500ms) → "1s"
 *  3. formatDuration — 90000ms → "1m 30s"
 *  4. formatDuration — exactly 60000ms → "1m"
 *  5. formatDuration — over 1 hour → "1h 2m 3s"
 *  6. renderConductSummary — quiet:true suppresses all output
 *  7. renderConductSummary — empty subtaskResults → one-liner fallback
 *  8. renderConductSummary — single subtask renders row
 *  9. renderConductSummary — mixed passed/failed/skipped rows
 * 10. renderConductSummary — long goal is truncated in header
 * 11. renderConductSummary — long subtask name is truncated with ellipsis
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { formatDuration, renderConductSummary } from "../../src/cli/conduct-summary.js";
import type { GoalResult } from "../../src/cli/goal.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResult(overrides: Partial<GoalResult> = {}): GoalResult {
  return {
    success: true,
    attempts: 1,
    criteriaResults: {},
    runLogPath: "/tmp/run.jsonl",
    summary: "Orchestrator completed: 2 jobs.",
    durationMs: 90000,
    subtaskResults: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// formatDuration
// ---------------------------------------------------------------------------

describe("formatDuration", () => {
  it("returns 0s for 0ms", () => {
    expect(formatDuration(0)).toBe("0s");
  });

  it("returns seconds for sub-minute durations", () => {
    expect(formatDuration(1500)).toBe("1s");
    expect(formatDuration(59999)).toBe("59s");
  });

  it("returns 1m for exactly 60000ms", () => {
    expect(formatDuration(60000)).toBe("1m");
  });

  it("returns m s for minute durations", () => {
    expect(formatDuration(90000)).toBe("1m 30s");
    expect(formatDuration(272000)).toBe("4m 32s");
  });

  it("returns h m s for over-1-hour durations", () => {
    expect(formatDuration(3723000)).toBe("1h 2m 3s");
  });
});

// ---------------------------------------------------------------------------
// renderConductSummary — output capture
// ---------------------------------------------------------------------------

describe("renderConductSummary", () => {
  let logLines: string[];
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logLines = [];
    consoleSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logLines.push(args.map(a => (typeof a === "string" ? a.replace(/\x1b\[[0-9;]*m/g, "") : String(a))).join(" "));
    });
    // Mock process.stdout.columns for consistent widths
    Object.defineProperty(process.stdout, "columns", { value: 80, configurable: true });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("suppresses all output when quiet:true", () => {
    renderConductSummary(makeResult(), "/spec.md", "my goal", { quiet: true });
    expect(logLines).toHaveLength(0);
  });

  it("renders one-liner fallback when subtaskResults is empty", () => {
    const result = makeResult({ success: true, summary: "Orchestrator completed: 0 jobs.", subtaskResults: {} });
    renderConductSummary(result, "/tmp/spec.md", "build a thing", {});
    const output = logLines.join("\n");
    expect(output).toContain("Orchestrator completed: 0 jobs.");
    expect(output).toContain("1m 30s");
  });

  it("renders a single subtask row with passed status", () => {
    const result = makeResult({
      subtaskResults: {
        "architect-the-system": { title: "Architect the system", role: "architect", status: "passed" },
      },
    });
    renderConductSummary(result, "/tmp/spec.md", "build something", {});
    const output = logLines.join("\n");
    expect(output).toContain("Architect the system");
    expect(output).toContain("architect");
    expect(output).toContain("passed");
    expect(output).toContain("1 passed");
  });

  it("renders mixed passed/failed/skipped rows with correct counts", () => {
    const result = makeResult({
      success: false,
      durationMs: 272000,
      subtaskResults: {
        "design-schema": { title: "Design schema", role: "architect", status: "passed" },
        "implement-auth": { title: "Implement auth", role: "implementer", status: "failed" },
        "write-tests": { title: "Write tests", role: "tester", status: "skipped" },
      },
    });
    renderConductSummary(result, "/tmp/spec.md", "add JWT auth", {});
    const output = logLines.join("\n");
    expect(output).toContain("1 passed");
    expect(output).toContain("1 failed");
    expect(output).toContain("1 skipped");
    expect(output).toContain("4m 32s");
  });

  it("truncates long goal with ellipsis in the header", () => {
    const longGoal = "a".repeat(200);
    renderConductSummary(makeResult({ subtaskResults: {} }), "/tmp/spec.md", longGoal, {});
    const output = logLines.join("\n");
    expect(output).toContain("…");
  });

  it("truncates long subtask names with ellipsis", () => {
    const result = makeResult({
      subtaskResults: {
        "long-job": {
          title: "a".repeat(100),
          role: "architect",
          status: "passed",
        },
      },
    });
    renderConductSummary(result, "/tmp/spec.md", "some goal", {});
    const output = logLines.join("\n");
    expect(output).toContain("…");
  });

  it("shows spec path and re-run hint", () => {
    renderConductSummary(makeResult({ subtaskResults: {} }), "/tmp/my-spec.md", "goal", {});
    const output = logLines.join("\n");
    expect(output).toContain("my-spec.md");
    expect(output).toContain("--orchestrator");
  });
});
