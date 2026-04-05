/**
 * Static bear renderer (V1).
 *
 * Prints the appropriate ASCII art for the given state and returns.
 * Width detection happens at render time (not construction time)
 * so terminal resizes are handled.
 */

import chalk from "chalk";
import { BearState, type BearRenderer } from "./types.js";
import { getBearArt } from "./art.js";

export class StaticBearRenderer implements BearRenderer {
  private noBanner: boolean;

  constructor(options?: { noBanner?: boolean }) {
    this.noBanner = options?.noBanner ?? false;
  }

  render(state: BearState, message?: string): void {
    // --no-banner suppresses greeting only
    if (this.noBanner && state === BearState.greeting) return;

    const cols = process.stdout.columns || 0;

    // Below 40 cols: text-only, no art
    if (cols > 0 && cols < 40) {
      if (message) console.log(message);
      return;
    }

    // 40-59 cols: compact single-line bear
    const compact = cols > 0 && cols < 60;
    const art = getBearArt(state, compact);

    // Thinking state: inline, no blank lines
    if (state === BearState.thinking) {
      console.log(art);
      return;
    }

    // Greeting: bear above version (personality-first)
    if (state === BearState.greeting) {
      console.log("");
      console.log(art);
      if (message) console.log(message);
      return;
    }

    // Success/error/help: 1 blank line above, art, optional message, 1 blank line below
    console.log("");
    console.log(art);
    if (message) console.log(message);
    console.log("");
  }
}
