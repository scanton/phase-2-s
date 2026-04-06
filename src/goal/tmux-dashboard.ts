/**
 * tmux dashboard for parallel dark factory execution.
 *
 * Optional visual layer (--dashboard flag). Creates a tmux session with
 * one pane per active worker, showing live progress.
 *
 * Falls back gracefully if tmux is not installed.
 */

import { execSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DashboardState {
  sessionName: string;
  panes: Map<number, string>; // index → pane ID
  active: boolean;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check if tmux is available on the system.
 */
export function isTmuxAvailable(): boolean {
  try {
    execSync("which tmux", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a tmux session for the parallel dashboard.
 *
 * @param specName  Name of the spec being executed (for the session title).
 * @param workerCount Number of workers in the first level.
 * @returns Dashboard state, or null if tmux is unavailable.
 */
export function createDashboard(specName: string, workerCount: number): DashboardState | null {
  if (!isTmuxAvailable()) return null;

  const sessionName = `phase2s-${Date.now()}`;

  try {
    // Create detached session
    execSync(`tmux new-session -d -s "${sessionName}" -x 200 -y 50`, { stdio: "pipe" });

    // Set window title
    execSync(`tmux rename-window -t "${sessionName}" "PHASE2S PARALLEL — ${specName}"`, { stdio: "pipe" });

    const panes = new Map<number, string>();

    // Create additional panes (first pane exists by default)
    for (let i = 1; i < workerCount; i++) {
      execSync(`tmux split-window -t "${sessionName}" -h`, { stdio: "pipe" });
    }

    // Tile the panes evenly
    execSync(`tmux select-layout -t "${sessionName}" tiled`, { stdio: "pipe" });

    // Get pane IDs
    const paneList = execSync(`tmux list-panes -t "${sessionName}" -F "#{pane_index}:#{pane_id}"`, {
      encoding: "utf8",
      stdio: "pipe",
    }).trim().split("\n");

    for (const line of paneList) {
      const [indexStr, paneId] = line.split(":");
      if (indexStr && paneId) {
        panes.set(parseInt(indexStr, 10), paneId);
      }
    }

    return { sessionName, panes, active: true };
  } catch {
    return null;
  }
}

/**
 * Send text to a specific worker's pane.
 */
export function updateWorkerPane(
  dashboard: DashboardState,
  workerIndex: number,
  text: string,
): void {
  if (!dashboard.active) return;

  const paneId = dashboard.panes.get(workerIndex);
  if (!paneId) return;

  try {
    // Send keys to the pane (display text)
    const escaped = text.replace(/"/g, '\\"');
    execSync(`tmux send-keys -t "${paneId}" "echo \\"${escaped}\\"" Enter`, { stdio: "pipe" });
  } catch {
    // Pane may have been closed
  }
}

/**
 * Update the status bar of the dashboard.
 */
export function updateStatusBar(
  dashboard: DashboardState,
  status: string,
): void {
  if (!dashboard.active) return;

  try {
    execSync(`tmux set-option -t "${dashboard.sessionName}" status-left "[${status}]"`, { stdio: "pipe" });
  } catch {
    // Ignore
  }
}

/**
 * Tear down the tmux dashboard session.
 */
export function teardownDashboard(dashboard: DashboardState): void {
  if (!dashboard.active) return;

  try {
    execSync(`tmux kill-session -t "${dashboard.sessionName}"`, { stdio: "pipe" });
  } catch {
    // Session may already be gone
  }

  dashboard.active = false;
}
