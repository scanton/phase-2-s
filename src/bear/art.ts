/**
 * Bear ASCII art — fixed-frame with swappable eye/mouth slots.
 *
 * Pure ASCII only (no Unicode, no emoji) for Windows compatibility.
 * 7-line bear face: ears, forehead, eyes, nose, mouth, chin.
 * Lines 1-3 (ears/forehead), line 5 (nose), and line 7 (chin) never change.
 * Only lines 4 (eyes) and 6 (mouth) swap per pose.
 */

import chalk from "chalk";
import { BearState } from "./types.js";

// ---------------------------------------------------------------------------
// Fixed frame lines (never change across poses)
// ---------------------------------------------------------------------------

const ear1 = "   _     _";
const ear2 = "  ( \\   / )";
const brow = "   \\ \\_/ /";
const nose = "  (  (_)  )";
const chin = "    '---'";

// ---------------------------------------------------------------------------
// Variable lines per pose (eyes + mouth)
// ---------------------------------------------------------------------------

const poses: Record<BearState, { eyes: string; mouth: string }> = {
  [BearState.greeting]: { eyes: "  ( o   o )", mouth: "   ( - - )" },
  [BearState.thinking]: { eyes: "  ( -   - )", mouth: "   ( ~ ~ )" },
  [BearState.success]:  { eyes: "  ( ^   ^ )", mouth: "   ( w w )" },
  [BearState.error]:    { eyes: "  ( O   O )", mouth: "   ( x x )" },
  [BearState.help]:     { eyes: "  ( o   o )", mouth: "   ( > > )" },
};

// ---------------------------------------------------------------------------
// Pose assembly
// ---------------------------------------------------------------------------

function renderPose(state: BearState): string {
  const p = poses[state];
  return chalk.white(
    [ear1, ear2, brow, p.eyes, nose, p.mouth, chin].join("\n"),
  );
}

const fullPoses: Record<BearState, string> = {
  [BearState.greeting]: renderPose(BearState.greeting),
  [BearState.thinking]: renderPose(BearState.thinking),
  [BearState.success]:  renderPose(BearState.success),
  [BearState.error]:    renderPose(BearState.error),
  [BearState.help]:     renderPose(BearState.help),
};

// Compact single-line versions for narrow terminals
const compactPoses: Record<BearState, string> = {
  [BearState.greeting]: chalk.white("(o.o)"),
  [BearState.thinking]: chalk.dim("(-.-) thinking..."),
  [BearState.success]:  chalk.white("(^.^)") + " " + chalk.green("done!"),
  [BearState.error]:    chalk.white("(O.O)") + " " + chalk.red("uh oh"),
  [BearState.help]:     chalk.white("(o.o)>"),
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export function getBearArt(state: BearState, compact: boolean): string {
  return compact ? compactPoses[state] : fullPoses[state];
}

export { fullPoses, compactPoses };
