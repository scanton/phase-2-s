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
