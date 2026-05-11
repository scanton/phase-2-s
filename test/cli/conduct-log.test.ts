/**
 * Tests for conduct-log.ts — appendConductLog, readConductLog, renderConductLog.
 *
 * Sprint 90 tests (36-50):
 *
 * appendConductLog:
 * 36. Writes a valid JSONL entry to .phase2s/conduct-log.jsonl
 * 37. Auto-creates .phase2s/ directory if it doesn't exist (first-run safety)
 * 38. Appends multiple entries as separate lines (not overwriting)
 *
 * readConductLog:
 * 39. Returns empty array when log file does not exist
 * 40. Returns entries newest-first (reversed from file order)
 * 41. Respects limit — returns at most N entries
 * 42. Omits limit — returns all entries
 * 43. Skips malformed lines, returns parseable entries
 * 44. Skips empty lines silently
 *
 * renderConductLog:
 * 45. Prints "No conduct runs logged yet" when entries is empty
 * 46. Prints table rows for each entry
 * 47. Shows ✓ pass for success, ✗ fail for failure
 *
 * conduct-log integration:
 * 48. conduct-log --json: readConductLog entries are serializable to JSON
 * 49. Goal truncated at 200 chars in entry
 * 50. appendConductLog error does not propagate (tested via runConduct integration in conduct.test.ts)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { appendConductLog, readConductLog, renderConductLog } from "../../src/cli/conduct-log.js";
import type { ConductLogEntry } from "../../src/cli/conduct-log.js";

// ---------------------------------------------------------------------------
// Shared fixture
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<ConductLogEntry> = {}): ConductLogEntry {
  return {
    ts: "2026-05-10T21:00:00.000Z",
    goal: "Add a health endpoint",
    specPath: "/tmp/.phase2s/specs/fake.md",
    specHash: "abcd1234",
    subtaskCount: 4,
    roles: ["architect", "implementer", "tester", "reviewer"],
    success: true,
    durationMs: 154_000,
    runLogPath: "/tmp/.phase2s/runs/fake.jsonl",
    rounds: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Temp directory management
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "conduct-log-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// appendConductLog
// ---------------------------------------------------------------------------

describe("appendConductLog", () => {
  it("36. writes a valid JSONL entry to .phase2s/conduct-log.jsonl", async () => {
    const entry = makeEntry();
    await appendConductLog(entry, tmpDir);

    const logPath = join(tmpDir, ".phase2s", "conduct-log.jsonl");
    const raw = readFileSync(logPath, "utf8");
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.goal).toBe("Add a health endpoint");
    expect(parsed.success).toBe(true);
    expect(parsed.rounds).toBe(0);
  });

  it("37. auto-creates .phase2s/ directory if it doesn't exist (first-run safety)", async () => {
    // Do NOT pre-create .phase2s/ — appendConductLog must handle this.
    const entry = makeEntry();
    await expect(appendConductLog(entry, tmpDir)).resolves.not.toThrow();

    const logPath = join(tmpDir, ".phase2s", "conduct-log.jsonl");
    expect(readFileSync(logPath, "utf8").trim().length).toBeGreaterThan(0);
  });

  it("38. appends multiple entries as separate lines (not overwriting)", async () => {
    const e1 = makeEntry({ goal: "First goal" });
    const e2 = makeEntry({ goal: "Second goal", ts: "2026-05-10T22:00:00.000Z" });
    await appendConductLog(e1, tmpDir);
    await appendConductLog(e2, tmpDir);

    const logPath = join(tmpDir, ".phase2s", "conduct-log.jsonl");
    const lines = readFileSync(logPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).goal).toBe("First goal");
    expect(JSON.parse(lines[1]).goal).toBe("Second goal");
  });
});

// ---------------------------------------------------------------------------
// readConductLog
// ---------------------------------------------------------------------------

describe("readConductLog", () => {
  it("39. returns empty array when log file does not exist", async () => {
    const entries = await readConductLog(tmpDir);
    expect(entries).toEqual([]);
  });

  it("40. returns entries newest-first (reversed from file order)", async () => {
    const e1 = makeEntry({ goal: "Oldest", ts: "2026-05-10T18:00:00.000Z" });
    const e2 = makeEntry({ goal: "Middle", ts: "2026-05-10T19:00:00.000Z" });
    const e3 = makeEntry({ goal: "Newest", ts: "2026-05-10T20:00:00.000Z" });
    await appendConductLog(e1, tmpDir);
    await appendConductLog(e2, tmpDir);
    await appendConductLog(e3, tmpDir);

    const entries = await readConductLog(tmpDir);
    expect(entries[0].goal).toBe("Newest");
    expect(entries[1].goal).toBe("Middle");
    expect(entries[2].goal).toBe("Oldest");
  });

  it("41. respects limit — returns at most N entries", async () => {
    for (let i = 0; i < 5; i++) {
      await appendConductLog(makeEntry({ goal: `Goal ${i}` }), tmpDir);
    }
    const entries = await readConductLog(tmpDir, 3);
    expect(entries).toHaveLength(3);
  });

  it("42. omits limit — returns all entries", async () => {
    for (let i = 0; i < 7; i++) {
      await appendConductLog(makeEntry({ goal: `Goal ${i}` }), tmpDir);
    }
    const entries = await readConductLog(tmpDir);
    expect(entries).toHaveLength(7);
  });

  it("43. skips malformed lines, returns parseable entries", async () => {
    mkdirSync(join(tmpDir, ".phase2s"), { recursive: true });
    const logPath = join(tmpDir, ".phase2s", "conduct-log.jsonl");
    // Write two good lines with a malformed line in between
    const good1 = JSON.stringify(makeEntry({ goal: "Good one" }));
    const good2 = JSON.stringify(makeEntry({ goal: "Good two" }));
    writeFileSync(logPath, `${good1}\n{BROKEN JSON\n${good2}\n`, "utf8");

    const entries = await readConductLog(tmpDir);
    expect(entries).toHaveLength(2);
    // Returned newest-first — good2 was last in file so it's first after reverse
    expect(entries[0].goal).toBe("Good two");
    expect(entries[1].goal).toBe("Good one");
  });

  it("44. skips empty lines silently", async () => {
    mkdirSync(join(tmpDir, ".phase2s"), { recursive: true });
    const logPath = join(tmpDir, ".phase2s", "conduct-log.jsonl");
    const good = JSON.stringify(makeEntry({ goal: "Valid entry" }));
    writeFileSync(logPath, `\n\n${good}\n\n`, "utf8");

    const entries = await readConductLog(tmpDir);
    expect(entries).toHaveLength(1);
    expect(entries[0].goal).toBe("Valid entry");
  });
});

// ---------------------------------------------------------------------------
// renderConductLog
// ---------------------------------------------------------------------------

describe("renderConductLog", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("45. prints 'No conduct runs logged yet' when entries is empty", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    renderConductLog([]);
    const output = spy.mock.calls.flat().join("\n");
    expect(output).toContain("No conduct runs logged yet");
  });

  it("46. prints table rows for each entry", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    renderConductLog([
      makeEntry({ goal: "Add a health endpoint", durationMs: 154_000 }),
    ]);
    const output = spy.mock.calls.flat().join("\n");
    // Should contain the goal (possibly truncated) and a duration
    expect(output).toContain("Add a health endpoint");
    expect(output).toContain("2m");
  });

  it("47. shows ✓ pass for success, ✗ fail for failure", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    renderConductLog([
      makeEntry({ goal: "Passed goal", success: true }),
      makeEntry({ goal: "Failed goal", success: false }),
    ]);
    const output = spy.mock.calls.flat().join("\n");
    expect(output).toContain("✓ pass");
    expect(output).toContain("✗ fail");
  });
});

// ---------------------------------------------------------------------------
// Schema round-trip
// ---------------------------------------------------------------------------

describe("ConductLogEntry schema", () => {
  it("48. entries serialized by appendConductLog are deserializable as JSON", async () => {
    const entry = makeEntry({ goal: "test goal", rounds: 2, success: false });
    await appendConductLog(entry, tmpDir);
    const entries = await readConductLog(tmpDir);
    expect(entries[0]).toMatchObject({
      goal: "test goal",
      rounds: 2,
      success: false,
    });
  });

  it("49. goal truncated at 200 chars is preserved in the entry (caller must truncate)", async () => {
    // appendConductLog stores whatever goal string is passed.
    // The caller (runConduct) is responsible for slicing at 200.
    const longGoal = "x".repeat(200);
    const entry = makeEntry({ goal: longGoal });
    await appendConductLog(entry, tmpDir);
    const entries = await readConductLog(tmpDir);
    expect(entries[0].goal).toHaveLength(200);
  });
});
