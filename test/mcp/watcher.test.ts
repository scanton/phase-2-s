/**
 * Tests for setupSkillsWatcher — the file-watching + hot-reload logic.
 *
 * node:fs is mocked so we can simulate watch events without touching the
 * real filesystem. The skills loader is mocked so we control what gets
 * "reloaded" after a watch event fires.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setupSkillsWatcher } from "../../src/mcp/watcher.js";
import type { Skill } from "../../src/skills/types.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock node:fs so watch events can be triggered manually in tests.
vi.mock("node:fs", () => ({
  watch: vi.fn(),
}));

// Mock the skills loader so we control what comes back after a reload.
vi.mock("../../src/skills/loader.js", () => ({
  loadSkillsFromDir: vi.fn().mockResolvedValue([]),
  loadAllSkills: vi.fn().mockResolvedValue([]),
  bundledSkillsDir: vi.fn().mockReturnValue("/mock/bundled/skills"),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NEW_SKILL: Skill = {
  name: "new-skill",
  description: "A freshly created skill",
  triggerPhrases: ["new skill"],
  promptTemplate: "Do the new thing.",
};

async function getWatchCallback(): Promise<() => void> {
  const { watch } = await import("node:fs");
  const mockWatch = vi.mocked(watch);
  // The callback is the 3rd argument passed to fs.watch()
  const calls = mockWatch.mock.calls;
  if (calls.length === 0) throw new Error("fs.watch was not called");
  const lastCall = calls[calls.length - 1];
  const cb = lastCall[2];
  if (typeof cb !== "function") throw new Error("fs.watch callback not found");
  return cb as () => void;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("setupSkillsWatcher (Sprint 12)", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    // Reset loader mock to return empty list by default
    const { loadSkillsFromDir } = await import("../../src/skills/loader.js");
    vi.mocked(loadSkillsFromDir).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("registers a watcher on the skills directory", async () => {
    const { watch } = await import("node:fs");
    setupSkillsWatcher("/project/.phase2s/skills", vi.fn(), vi.fn());
    expect(vi.mocked(watch)).toHaveBeenCalledWith(
      "/project/.phase2s/skills",
      { persistent: false },
      expect.any(Function),
    );
  });

  it("calls onReload with updated skills and notify after a watch event (debounced)", async () => {
    const { loadSkillsFromDir } = await import("../../src/skills/loader.js");
    vi.mocked(loadSkillsFromDir).mockResolvedValue([NEW_SKILL]);

    const onReload = vi.fn();
    const notify = vi.fn();

    setupSkillsWatcher("/project/.phase2s/skills", onReload, notify);

    const watchCb = await getWatchCallback();
    watchCb(); // simulate a file-system event

    // Nothing should have fired yet — still within the debounce window
    expect(onReload).not.toHaveBeenCalled();

    // Advance past the 80ms debounce and flush the promise
    await vi.runAllTimersAsync();

    expect(onReload).toHaveBeenCalledWith([NEW_SKILL]);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("debounces rapid events — onReload is called only once", async () => {
    const onReload = vi.fn();
    const notify = vi.fn();

    setupSkillsWatcher("/project/.phase2s/skills", onReload, notify);

    const watchCb = await getWatchCallback();

    // Three rapid events (e.g. mkdir + write + rename from a single /skill run)
    watchCb();
    watchCb();
    watchCb();

    await vi.runAllTimersAsync();

    expect(onReload).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("silently swallows errors when skills directory does not exist", async () => {
    const { watch } = await import("node:fs");
    vi.mocked(watch).mockImplementation(() => {
      throw Object.assign(new Error("ENOENT: no such file or directory"), { code: "ENOENT" });
    });

    const onReload = vi.fn();
    const notify = vi.fn();

    // Should not throw
    expect(() =>
      setupSkillsWatcher("/nonexistent/.phase2s/skills", onReload, notify),
    ).not.toThrow();

    // And naturally, nothing was called
    await vi.runAllTimersAsync();
    expect(onReload).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Watcher handle return value (Sprint 54 — v1.28.0)
// ---------------------------------------------------------------------------

describe("setupSkillsWatcher — watcher handle (Sprint 54)", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    // Default: watch succeeds and returns a mock FSWatcher
    const { watch } = await import("node:fs");
    vi.mocked(watch).mockImplementation(() => {
      return { close: vi.fn() } as unknown as ReturnType<typeof import("node:fs").watch>;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a watcher handle when the directory is watchable", async () => {
    const watcher = setupSkillsWatcher("/project/.phase2s/skills", vi.fn(), vi.fn());
    expect(watcher).not.toBeNull();
    expect(typeof watcher?.close).toBe("function");
  });

  it("returns null when the directory is not watchable (watch throws)", async () => {
    const { watch } = await import("node:fs");
    vi.mocked(watch).mockImplementation(() => {
      throw Object.assign(new Error("ENOENT: no such file or directory"), { code: "ENOENT" });
    });

    const watcher = setupSkillsWatcher("/nonexistent/.phase2s/skills", vi.fn(), vi.fn());
    expect(watcher).toBeNull();
  });

  it("returned watcher can be closed without error", async () => {
    const mockClose = vi.fn();
    const { watch } = await import("node:fs");
    vi.mocked(watch).mockImplementation(() => {
      return { close: mockClose } as unknown as ReturnType<typeof import("node:fs").watch>;
    });

    const watcher = setupSkillsWatcher("/project/.phase2s/skills", vi.fn(), vi.fn());
    expect(() => watcher?.close()).not.toThrow();
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it("closing the watcher stops further event callbacks from being invoked", async () => {
    const { watch } = await import("node:fs");
    // Return a watcher that tracks whether close() was called via a flag.
    let watchCallback: (() => void) | null = null;
    let closed = false;
    const mockClose = vi.fn().mockImplementation(() => {
      closed = true;
    });
    vi.mocked(watch).mockImplementation((_path, _opts, cb) => {
      watchCallback = cb as () => void;
      return {
        close: mockClose,
      } as unknown as ReturnType<typeof import("node:fs").watch>;
    });

    const { loadSkillsFromDir } = await import("../../src/skills/loader.js");
    vi.mocked(loadSkillsFromDir).mockResolvedValue([]);

    const onReload = vi.fn();
    const watcher = setupSkillsWatcher("/project/.phase2s/skills", onReload, vi.fn());

    // Close the watcher before any events fire
    watcher?.close();
    expect(closed).toBe(true);
    expect(mockClose).toHaveBeenCalledTimes(1);

    // Suppress unused-variable warning — watchCallback is captured to simulate
    // the OS not delivering events after close().
    void watchCallback;
    expect(onReload).not.toHaveBeenCalled();
  });

  it("close() cancels a pending debounce timer before stopping the watcher", async () => {
    // Verify that calling close() mid-debounce clears the timer, so onReload
    // is NOT called after the watcher is shut down.
    const mockClose = vi.fn();
    const { watch } = await import("node:fs");
    vi.mocked(watch).mockImplementation((_path, _opts, cb) => {
      // Immediately invoke the watch callback to start the debounce timer
      setTimeout(() => (cb as () => void)(), 0);
      return { close: mockClose } as unknown as ReturnType<typeof import("node:fs").watch>;
    });

    const { loadSkillsFromDir } = await import("../../src/skills/loader.js");
    vi.mocked(loadSkillsFromDir).mockResolvedValue([]);
    const onReload = vi.fn();

    const watcher = setupSkillsWatcher("/project/.phase2s/skills", onReload, vi.fn());

    // Advance time enough to trigger the watch callback but not past the debounce
    await vi.advanceTimersByTimeAsync(10);
    // Now close — should cancel the pending debounce
    watcher?.close();
    // Run all remaining timers — the debounce should NOT fire
    await vi.runAllTimersAsync();

    expect(onReload).not.toHaveBeenCalled();
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it("server teardown pattern: watcher?.close() is safe when watcher is null", () => {
    // This tests the ?.close() optional-chaining pattern used in server.ts rl.on("close").
    const nullWatcher: ReturnType<typeof setupSkillsWatcher> = null;
    expect(() => nullWatcher?.close()).not.toThrow();
  });
});
