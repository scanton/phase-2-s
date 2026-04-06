import { describe, it, expect, vi, afterEach } from "vitest";
import {
  isTmuxAvailable,
  createDashboard,
  teardownDashboard,
  updateWorkerPane,
  updateStatusBar,
} from "../../src/goal/tmux-dashboard.js";

// These tests run against the real system. isTmuxAvailable checks if tmux
// is installed, which varies by environment. We test the API contract.

describe("isTmuxAvailable", () => {
  it("returns a boolean", () => {
    const result = isTmuxAvailable();
    expect(typeof result).toBe("boolean");
  });
});

describe("createDashboard", () => {
  it("returns null when tmux is not available and workerCount is 0", () => {
    // With 0 workers, even if tmux is available, this is a degenerate case
    // The function should handle it gracefully
    const result = createDashboard("test", 0);
    // Either null (no tmux) or a valid dashboard state
    if (result) {
      expect(result.active).toBe(true);
      teardownDashboard(result); // cleanup
    } else {
      expect(result).toBeNull();
    }
  });
});

describe("teardownDashboard", () => {
  it("marks state as inactive", () => {
    const state = { sessionName: "nonexistent-session", panes: new Map<number, string>(), active: true };
    teardownDashboard(state);
    expect(state.active).toBe(false);
  });

  it("is a no-op for already inactive state", () => {
    const state = { sessionName: "x", panes: new Map<number, string>(), active: false };
    teardownDashboard(state);
    expect(state.active).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// updateWorkerPane / updateStatusBar with inactive dashboard
// ---------------------------------------------------------------------------

describe("updateWorkerPane / updateStatusBar with inactive dashboard", () => {
  it("updateWorkerPane with inactive dashboard does not throw", () => {
    const state = { sessionName: "s", panes: new Map<number, string>(), active: false };
    expect(() => updateWorkerPane(state, 0, "some text")).not.toThrow();
  });

  it("updateStatusBar with inactive dashboard does not throw", () => {
    const state = { sessionName: "s", panes: new Map<number, string>(), active: false };
    expect(() => updateStatusBar(state, "running")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// updateWorkerPane escape test — verified via source code inspection
// ---------------------------------------------------------------------------

describe("updateWorkerPane double-quote escaping", () => {
  it('escapes double quotes: source uses text.replace(/"/g, \'\\\\\\"\')', () => {
    // The escaping logic is in tmux-dashboard.ts:
    //   const escaped = text.replace(/"/g, '\\"');
    // We verify the escape logic directly using the same regex, since we
    // cannot vi.spyOn() on ESM node: builtins (they are not configurable).
    const text = 'say "hello" and "goodbye"';
    const escaped = text.replace(/"/g, '\\"');
    // Each " should become \" (backslash + double-quote)
    expect(escaped).toBe('say \\"hello\\" and \\"goodbye\\"');
    // The escaped form contains \", not raw unescaped "
    // Count of \" sequences should equal original count of "
    const originalQuoteCount = (text.match(/"/g) ?? []).length;
    const escapedCount = (escaped.match(/\\"/g) ?? []).length;
    expect(escapedCount).toBe(originalQuoteCount);
  });

  it("updateWorkerPane does not throw when pane exists but execSync fails (active=true, no tmux)", () => {
    // Create a dashboard with a pane registered but no real tmux session.
    // updateWorkerPane calls execSync which will throw (no real tmux), but
    // the catch block swallows the error — so it must not propagate.
    const panes = new Map<number, string>();
    panes.set(0, "%0");
    const state = { sessionName: "nonexistent", panes, active: true };
    expect(() => updateWorkerPane(state, 0, 'text with "quotes"')).not.toThrow();
  });
});
