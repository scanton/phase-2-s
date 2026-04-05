import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { RunLogger, buildLogPath, formatTimestamp } from "../../src/core/run-logger.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  const dir = join(tmpdir(), `phase2s-run-logger-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function readLines(path: string): unknown[] {
  const raw = readFileSync(path, "utf8").trim();
  return raw.split("\n").map((l) => JSON.parse(l));
}

// ---------------------------------------------------------------------------
// RunLogger
// ---------------------------------------------------------------------------

describe("RunLogger", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates runs directory lazily on first log call", () => {
    const logger = new RunLogger(tmpDir, "abc123def456");
    // Directory should not exist yet
    let exists = true;
    try {
      readFileSync(join(tmpDir, ".phase2s", "runs"), "utf8");
    } catch {
      exists = false;
    }
    // The directory hasn't been created yet (it's lazy)
    const beforeLog = join(tmpDir, ".phase2s", "runs");
    let dirExistedBefore = false;
    try {
      require("fs").readdirSync(beforeLog);
      dirExistedBefore = true;
    } catch {
      dirExistedBefore = false;
    }
    expect(dirExistedBefore).toBe(false);
    void exists; // satisfy no-unused

    logger.log({ event: "plan_review_started" });

    // Now the directory should exist
    const { readdirSync } = require("fs") as typeof import("fs");
    expect(() => readdirSync(beforeLog)).not.toThrow();
  });

  it("appends JSONL lines with ts field", () => {
    const logger = new RunLogger(tmpDir, "abc123def456");
    logger.log({ event: "plan_review_started" });
    logger.log({ event: "attempt_started", attempt: 1 });

    const logPath = logger.close();
    const lines = readLines(logPath);

    expect(lines).toHaveLength(2);
    const first = lines[0] as Record<string, unknown>;
    const second = lines[1] as Record<string, unknown>;

    expect(first["event"]).toBe("plan_review_started");
    expect(typeof first["ts"]).toBe("string");
    expect(second["event"]).toBe("attempt_started");
    expect(second["attempt"]).toBe(1);
    expect(typeof second["ts"]).toBe("string");
  });

  it("close() returns an absolute path", () => {
    const logger = new RunLogger(tmpDir, "abc123def456");
    const logPath = logger.close();
    expect(isAbsolute(logPath)).toBe(true);
  });

  it("log file survives multiple calls — all lines present", () => {
    const logger = new RunLogger(tmpDir, "abc123def456");
    for (let i = 0; i < 5; i++) {
      logger.log({ event: "attempt_started", attempt: i + 1 });
    }
    const logPath = logger.close();
    const lines = readLines(logPath);
    expect(lines).toHaveLength(5);
  });

  it("filename includes date and hash.slice(0, 8)", () => {
    const hash = "deadbeef11223344556677889900aabb";
    const logger = new RunLogger(tmpDir, hash);
    logger.log({ event: "plan_review_started" });
    const logPath = logger.close();
    const filename = logPath.split("/").pop()!;
    // Filename should contain the first 8 chars of the hash
    expect(filename).toContain("deadbeef");
    // Filename should match pattern YYYY-MM-DDTHH-MM-SS-{hash}.jsonl
    expect(filename).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-deadbeef\.jsonl$/);
  });

  it("throws on write failure when runs directory is removed mid-run", () => {
    const logger = new RunLogger(tmpDir, "abc123def456");
    // First log creates the directory
    logger.log({ event: "plan_review_started" });

    // Remove the entire specDir to simulate disk failure
    rmSync(tmpDir, { recursive: true, force: true });

    // Subsequent log should throw since the directory is gone
    expect(() => {
      logger.log({ event: "attempt_started", attempt: 2 });
    }).toThrow();
  });
});

// ---------------------------------------------------------------------------
// formatTimestamp
// ---------------------------------------------------------------------------

describe("formatTimestamp", () => {
  it("formats date as YYYY-MM-DDTHH-MM-SS", () => {
    const d = new Date("2026-04-05T12:30:45.000Z");
    // Note: result depends on local timezone — we just check the pattern
    const ts = formatTimestamp(d);
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/);
  });

  it("uses hyphens instead of colons (filesystem-safe)", () => {
    const d = new Date("2026-04-05T12:30:45.000Z");
    const ts = formatTimestamp(d);
    expect(ts).not.toContain(":");
  });
});

// ---------------------------------------------------------------------------
// buildLogPath
// ---------------------------------------------------------------------------

describe("buildLogPath", () => {
  it("returns absolute path under <specDir>/.phase2s/runs/", () => {
    const path = buildLogPath("/some/project", "abc123");
    expect(path).toContain("/.phase2s/runs/");
    expect(isAbsolute(path)).toBe(true);
    expect(path.endsWith(".jsonl")).toBe(true);
  });

  it("includes first 8 chars of hash in filename", () => {
    const path = buildLogPath("/some/project", "deadbeef12345678");
    const filename = path.split("/").pop()!;
    expect(filename).toContain("deadbeef");
  });
});
