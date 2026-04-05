/**
 * Bear mascot module — singleton factory.
 *
 * Call initBear(config) once at CLI bootstrap.
 * Import { bear } anywhere to render bear states.
 *
 * Suppression conditions (bear renders ONLY when ALL are true):
 * - process.stdout.isTTY === true
 * - NOT in MCP mode
 * - NOT bear: false in config
 * - NOT --quiet or --json flags
 */

import type { Config } from "../core/config.js";
import { BearState, type BearRenderer } from "./types.js";
import { StaticBearRenderer } from "./static-renderer.js";

// ---------------------------------------------------------------------------
// No-op renderer for suppressed environments
// ---------------------------------------------------------------------------

class NoOpRenderer implements BearRenderer {
  render(_state: BearState, _message?: string): void {
    // Intentionally empty
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

/** Module-level singleton. NoOp until initBear() is called. */
let _instance: BearRenderer = new NoOpRenderer();

/** MCP mode flag — set by the MCP server entry point. */
let _mcpMode = false;

/**
 * Mark the current process as running in MCP mode.
 * Can be called before or after initBear() — always wins.
 * Prevents bear output from corrupting the JSON-RPC stdout transport.
 */
export function setMcpMode(): void {
  _mcpMode = true;
  _instance = new NoOpRenderer();
}

/**
 * Initialize the bear renderer singleton.
 * Call once during CLI bootstrap. Subsequent calls are ignored.
 */
export function initBear(
  config: Record<string, unknown>,
  options?: { noBanner?: boolean },
): void {
  // Suppression checks
  if (_mcpMode) return;
  if (!process.stdout.isTTY) return;
  if ((config as { bear?: boolean }).bear === false) return;

  _instance = new StaticBearRenderer({ noBanner: options?.noBanner });
}

/** The bear singleton. Import this anywhere to render. */
export const bear: BearRenderer = {
  render(state: BearState, message?: string): void {
    _instance.render(state, message);
  },
};

export { BearState } from "./types.js";
export type { BearRenderer } from "./types.js";
