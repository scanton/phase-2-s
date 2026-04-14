/**
 * MCP skills directory watcher.
 *
 * Extracted from server.ts (Sprint 52 decomposition).
 */

import { watch, type FSWatcher } from "node:fs";
import { loadSkillsFromDir } from "../skills/loader.js";
import type { Skill } from "../skills/types.js";

/** Debounce window for hot-reload in milliseconds. 80ms catches burst writes without flickering. */
const WATCHER_DEBOUNCE_MS = 80;

/**
 * Watch the skills directory for new SKILL.md files. When a change is
 * detected (debounced WATCHER_DEBOUNCE_MS), reload skills and call notify() so the server
 * can send a notifications/tools/list_changed message to the MCP client.
 *
 * Returns the FSWatcher handle so the caller can close it on shutdown.
 * Returns null if the directory does not exist or isn't watchable (server
 * still works, just without hot-reload).
 *
 * Note: when the caller calls watcher.close(), Node.js stops dispatching new
 * events. A pending debounce timer might still fire once after close — that
 * reload is a no-op since the server is shutting down. Acceptable for v1.28.0.
 */
export function setupSkillsWatcher(
  skillsDir: string,
  onReload: (skills: Skill[]) => void,
  notify: () => void,
): FSWatcher | null {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  try {
    const watcher = watch(skillsDir, { persistent: false }, () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        loadSkillsFromDir(skillsDir)
          .then((updated) => {
            onReload(updated);
            notify();
          })
          .catch(() => {
            // Reload errors are silently ignored — stale skill list is better
            // than crashing the server.
          });
      }, WATCHER_DEBOUNCE_MS);
    });
    return watcher;
  } catch {
    // Skills directory doesn't exist or isn't watchable — skip silently.
    // The server still works, just without hot-reload.
    return null;
  }
}
