import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseRunLog, buildRunReport, formatRunReport } from "../../src/cli/report.js";
import type { RunEvent } from "../../src/core/run-logger.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type TimestampedEvent = RunEvent & { ts: string };

function ts(offsetMs = 0): string {
  return new Date(1_000_000_000_000 + offsetMs).toISOString();
}

const MINIMAL_EVENTS: TimestampedEvent[] = [
  { event: "goal_started", specFile: "pagination.md", specHash: "abc123", subTaskCount: 2, maxAttempts: 3, resuming: false, ts: ts(0) },
  { event: "attempt_started", attempt: 1, ts: ts(1000) },
  { event: "subtask_started", attempt: 1, index: 0, name: "Cursor logic", ts: ts(2000) },
  { event: "subtask_completed", attempt: 1, index: 0, status: "passed", ts: ts(10000) },
  { event: "subtask_started", attempt: 1, index: 1, name: "API format", ts: ts(11000) },
  { event: "subtask_completed", attempt: 1, index: 1, status: "failed", ts: ts(20000) },
  { event: "eval_started", command: "npm test", ts: ts(21000) },
  { event: "eval_completed", output: "tests failed", ts: ts(25000) },
  { event: "criteria_checked", results: { "All tests pass": false }, failing: ["All tests pass"], ts: ts(26000) },
  { event: "attempt_started", attempt: 2, ts: ts(27000) },
  { event: "subtask_started", attempt: 2, index: 1, name: "API format", ts: ts(28000) },
  { event: "subtask_completed", attempt: 2, index: 1, status: "passed", ts: ts(35000) },
  { event: "eval_started", command: "npm test", ts: ts(36000) },
  { event: "eval_completed", output: "all tests pass", ts: ts(40000) },
  { event: "criteria_checked", results: { "All tests pass": true }, failing: [], ts: ts(41000) },
  { event: "goal_completed", success: true, attempts: 2, ts: ts(42000) },
];

const CHALLENGED_EVENTS: TimestampedEvent[] = [
  { event: "goal_started", specFile: "vague.md", specHash: "def456", subTaskCount: 1, maxAttempts: 3, resuming: false, ts: ts(0) },
  { event: "plan_review_started", ts: ts(100) },
  { event: "plan_review_completed", verdict: "CHALLENGED", response: "VERDICT: CHALLENGED", ts: ts(5000) },
  { event: "goal_completed", success: false, attempts: 0, ts: ts(5100) },
];

// ---------------------------------------------------------------------------
// parseRunLog
// ---------------------------------------------------------------------------

describe("parseRunLog", () => {
  let tmpDir: string;
  let logPath: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `phase2s-report-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    logPath = join(tmpDir, "run.jsonl");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("parses valid JSONL into RunEvent array", () => {
    const lines = MINIMAL_EVENTS.map((e) => JSON.stringify(e)).join("\n");
    writeFileSync(logPath, lines, "utf8");
    const events = parseRunLog(logPath);
    expect(events).toHaveLength(MINIMAL_EVENTS.length);
    expect(events[0].event).toBe("goal_started");
  });

  it("throws when file does not exist", () => {
    expect(() => parseRunLog("/nonexistent/path/run.jsonl")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// buildRunReport
// ---------------------------------------------------------------------------

describe("buildRunReport", () => {
  it("sets specFile from goal_started event", () => {
    const report = buildRunReport(MINIMAL_EVENTS);
    expect(report.specFile).toBe("pagination.md");
  });

  it("computes sub-task durations from started/completed timestamps", () => {
    const report = buildRunReport(MINIMAL_EVENTS);
    const firstAttempt = report.attempts[0];
    const cursorTask = firstAttempt.subtasks.find((s) => s.name === "Cursor logic");
    expect(cursorTask?.durationMs).toBe(8000); // 10000ms - 2000ms
  });

  it("records criteria results from criteria_checked event", () => {
    const report = buildRunReport(MINIMAL_EVENTS);
    const lastAttempt = report.attempts[report.attempts.length - 1];
    expect(lastAttempt.criteria).toHaveLength(1);
    expect(lastAttempt.criteria[0].passed).toBe(true);
  });

  it("sets finalSuccess and finalAttempts from goal_completed", () => {
    const report = buildRunReport(MINIMAL_EVENTS);
    expect(report.finalSuccess).toBe(true);
    expect(report.finalAttempts).toBe(2);
  });

  it("computes total durationMs from goal_started to goal_completed", () => {
    const report = buildRunReport(MINIMAL_EVENTS);
    expect(report.durationMs).toBe(42000); // ts(42000) - ts(0)
  });

  it("sets challenged and challengeVerdict from plan_review_completed", () => {
    const report = buildRunReport(CHALLENGED_EVENTS);
    expect(report.challenged).toBe(true);
    expect(report.challengeVerdict).toBe("CHALLENGED");
    expect(report.finalSuccess).toBe(false);
  });

  it("sets error from goal_error event", () => {
    const errorEvents: TimestampedEvent[] = [
      { event: "goal_started", specFile: "bad.md", specHash: "aaa", subTaskCount: 1, maxAttempts: 3, resuming: false, ts: ts(0) },
      { event: "goal_error", message: "spec file not found", ts: ts(1000) },
    ];
    const report = buildRunReport(errorEvents);
    expect(report.error).toBe("spec file not found");
  });
});

// ---------------------------------------------------------------------------
// formatRunReport
// ---------------------------------------------------------------------------

describe("formatRunReport", () => {
  it("shows spec filename in output", () => {
    const report = buildRunReport(MINIMAL_EVENTS);
    const output = formatRunReport(report);
    expect(output).toContain("pagination.md");
  });

  it("shows ✓ and attempt count for successful run", () => {
    const report = buildRunReport(MINIMAL_EVENTS);
    const output = formatRunReport(report);
    expect(output).toContain("2 attempts");
    expect(output).toContain("Goal complete");
  });

  it("shows ✗ for failed run", () => {
    const failEvents: TimestampedEvent[] = [
      ...MINIMAL_EVENTS.slice(0, -1),
      { event: "goal_completed", success: false, attempts: 3, ts: ts(42000) },
    ];
    const report = buildRunReport(failEvents);
    const output = formatRunReport(report);
    expect(output).toContain("Goal failed");
  });

  it("shows CHALLENGED verdict when run was halted by review", () => {
    const report = buildRunReport(CHALLENGED_EVENTS);
    const output = formatRunReport(report);
    expect(output).toContain("CHALLENGED");
    expect(output).not.toContain("Attempt");
  });
});
