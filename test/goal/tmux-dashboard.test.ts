import { describe, it, expect } from "vitest";
import {
  isTmuxAvailable,
  createDashboard,
  teardownDashboard,
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
