/**
 * MCP skills directory watcher.
 *
 * Extracted from server.ts (Sprint 52 decomposition).
 */

import { watch } from "node:fs";
import { loadSkillsFromDir } from "../skills/loader.js";
import type { Skill } from "../skills/types.js";

/** Debounce window for hot-reload in milliseconds. 80ms catches burst writes without flickering. */
const WATCHER_DEBOUNCE_MS = 80;

/**
 * Watch the skills directory for new SKILL.md files. When a change is
 * detected (debounced WATCHER_DEBOUNCE_MS), reload skills and call notify() so the server
 * can send a notifications/tools/list_changed message to the MCP client.
 *
 * Returns a handle with a single `close()` method so the caller can shut
 * down both the fs.Watcher and any pending debounce timer together.
 * Returns null if the directory does not exist or isn't watchable (server
 * still works, just without hot-reload).
 *
 * Returning `{ close(): void }` rather than the raw FSWatcher keeps the
 * contract minimal and ensures callers cannot accumulate stale timers: the
 * close() method cancels the debounce before stopping the watcher.
 */
export function setupSkillsWatcher(
  skillsDir: string,
  onReload: (skills: Skill[]) => void,
  notify: () => void,
): { close(): void } | null {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  try {
    const fsWatcher = watch(skillsDir, { persistent: false }, () => {
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
    return {
      close() {
        // Cancel any pending debounce first — prevents a stale reload from
        // firing on a stream that may already be closed.
        if (debounceTimer) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
        }
        fsWatcher.close();
      },
    };
  } catch {
    // Skills directory doesn't exist or isn't watchable — skip silently.
    // The server still works, just without hot-reload.
    return null;
  }
}
