/**
 * MCP skills directory watcher.
 *
 * Extracted from server.ts (Sprint 52 decomposition).
 */

import { watch } from "node:fs";
import { loadSkillsFromDir } from "../skills/loader.js";
import type { Skill } from "../skills/types.js";

/**
 * Watch the skills directory for new SKILL.md files. When a change is
 * detected (debounced 80ms), reload skills and call notify() so the server
 * can send a notifications/tools/list_changed message to the MCP client.
 *
 * Silently skips watching if the directory does not exist.
 */
export function setupSkillsWatcher(
  skillsDir: string,
  onReload: (skills: Skill[]) => void,
  notify: () => void,
): void {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  try {
    watch(skillsDir, { persistent: false }, () => {
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
      }, 80);
    });
  } catch {
    // Skills directory doesn't exist or isn't watchable — skip silently.
    // The server still works, just without hot-reload.
  }
}
