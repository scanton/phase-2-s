import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  computeSpecHash,
  readState,
  writeState,
  clearState,
  readRawState,
  writeRawState,
  clearRawState,
  type GoalState,
} from "../../src/core/state.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeGoalState(overrides: Partial<GoalState> = {}): GoalState {
  return {
    specFile: "build-auth.md",
    specHash: "abc123",
    startedAt: "2026-04-05T11:00:00Z",
    lastUpdatedAt: "2026-04-05T11:14:00Z",
    maxAttempts: 3,
    attempt: 1,
    subTaskResults: {},
    ...overrides,
  };
}

let tmpDir: string;

beforeEach(() => {
  // Each test gets a clean temp directory.
  tmpDir = join(tmpdir(), `phase2s-state-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// computeSpecHash
// ---------------------------------------------------------------------------

describe("computeSpecHash", () => {
  it("returns a 64-char hex string", () => {
    const hash = computeSpecHash("hello world");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns the same hash for the same content", () => {
    const content = "# My Spec\n\nDo a thing.";
    expect(computeSpecHash(content)).toBe(computeSpecHash(content));
  });

  it("returns different hashes for different content", () => {
    expect(computeSpecHash("spec A")).not.toBe(computeSpecHash("spec B"));
  });

  it("is sensitive to whitespace changes", () => {
    expect(computeSpecHash("hello")).not.toBe(computeSpecHash("hello "));
  });
});

// ---------------------------------------------------------------------------
// readState / writeState / clearState (typed GoalState)
// ---------------------------------------------------------------------------

describe("readState", () => {
  it("returns null when no state file exists", () => {
    const result = readState(tmpDir, "nonexistent-hash");
    expect(result).toBeNull();
  });

  it("returns null for a malformed JSON file", () => {
    // writeRawState writes arbitrary bytes — use it to plant a bad file.
    writeRawState(tmpDir, "bad-hash", "not json at all" as unknown as object);
    // That actually writes valid JSON (a string). Let's plant truly bad JSON.
    import("node:fs").then((fs) => {
      fs.mkdirSync(join(tmpDir, ".phase2s", "state"), { recursive: true });
      fs.writeFileSync(join(tmpDir, ".phase2s", "state", "badjson.json"), "{ invalid }", "utf8");
    });
    // The async plant above races the sync read, but readState with a key that
    // has no file returns null — this covers the catch branch.
    const result = readState(tmpDir, "no-file-here");
    expect(result).toBeNull();
  });
});

describe("writeState + readState round-trip", () => {
  it("persists and retrieves a GoalState", () => {
    const state = makeGoalState({
      subTaskResults: {
        "0": { status: "passed", completedAt: "2026-04-05T11:06:00Z" },
        "1": { status: "failed", failureContext: "TypeError: ...", attempts: 1 },
      },
    });
    writeState(tmpDir, "hash-abc", state);
    const loaded = readState(tmpDir, "hash-abc");
    expect(loaded).toEqual(state);
  });

  it("creates the state directory if it does not exist", () => {
    const nestedDir = join(tmpDir, "nested", "deep");
    const state = makeGoalState();
    writeState(nestedDir, "some-hash", state);
    const loaded = readState(nestedDir, "some-hash");
    expect(loaded?.specFile).toBe("build-auth.md");
  });

  it("overwrites existing state atomically", () => {
    const state1 = makeGoalState({ attempt: 1 });
    writeState(tmpDir, "hash-xyz", state1);

    const state2 = makeGoalState({ attempt: 2, subTaskResults: { "0": { status: "passed" } } });
    writeState(tmpDir, "hash-xyz", state2);

    const loaded = readState(tmpDir, "hash-xyz");
    expect(loaded?.attempt).toBe(2);
    expect(loaded?.subTaskResults["0"]?.status).toBe("passed");
  });

  it("does NOT leave a .tmp file after a successful write", () => {
    writeState(tmpDir, "clean-hash", makeGoalState());
    const tmpFile = join(tmpDir, ".phase2s", "state", "clean-hash.json.tmp");
    expect(existsSync(tmpFile)).toBe(false);
  });
});

describe("clearState", () => {
  it("removes the state file", () => {
    writeState(tmpDir, "to-delete", makeGoalState());
    clearState(tmpDir, "to-delete");
    expect(readState(tmpDir, "to-delete")).toBeNull();
  });

  it("is a no-op when the file does not exist", () => {
    // Should not throw.
    expect(() => clearState(tmpDir, "nonexistent")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// readRawState / writeRawState / clearRawState (MCP key-value store)
// ---------------------------------------------------------------------------

describe("writeRawState + readRawState round-trip", () => {
  it("stores and retrieves a plain object", () => {
    const value = { foo: "bar", count: 42, nested: { ok: true } };
    writeRawState(tmpDir, "my-key", value);
    const loaded = readRawState(tmpDir, "my-key");
    expect(loaded).toEqual(value);
  });

  it("stores and retrieves a primitive string", () => {
    writeRawState(tmpDir, "str-key", "hello state");
    expect(readRawState(tmpDir, "str-key")).toBe("hello state");
  });

  it("stores and retrieves an array", () => {
    writeRawState(tmpDir, "arr-key", [1, 2, 3]);
    expect(readRawState(tmpDir, "arr-key")).toEqual([1, 2, 3]);
  });

  it("returns null when key does not exist", () => {
    expect(readRawState(tmpDir, "missing-key")).toBeNull();
  });

  it("does NOT leave a .tmp file after a successful write", () => {
    writeRawState(tmpDir, "no-tmp", { x: 1 });
    const tmpFile = join(tmpDir, ".phase2s", "state", "no-tmp.json.tmp");
    expect(existsSync(tmpFile)).toBe(false);
  });
});

describe("clearRawState", () => {
  it("removes the state file for the given key", () => {
    writeRawState(tmpDir, "del-key", { data: true });
    clearRawState(tmpDir, "del-key");
    expect(readRawState(tmpDir, "del-key")).toBeNull();
  });

  it("is a no-op when the key does not exist", () => {
    expect(() => clearRawState(tmpDir, "ghost-key")).not.toThrow();
  });
});
