/**
 * Bear ASCII art — composable parts for DRY assembly.
 *
 * Pure ASCII only (no Unicode, no emoji) for Windows compatibility.
 * Each pose is assembled from shared body parts + pose-specific face/arms.
 *
 * The bear is ~8 lines tall when fully assembled.
 */

import chalk from "chalk";
import { BearState } from "./types.js";

// ---------------------------------------------------------------------------
// Composable parts
// ---------------------------------------------------------------------------

const head = chalk.white("    .----.") ;

const faces: Record<string, string> = {
  neutral: chalk.white("   /") + chalk.dim(" o  o ") + chalk.white("\\"),
  happy:   chalk.white("   /") + chalk.dim(" ^  ^ ") + chalk.white("\\"),
  confused:chalk.white("   /") + chalk.dim(" o  O ") + chalk.white("\\"),
};

const mouths: Record<string, string> = {
  normal:  chalk.white("  (   ") + chalk.dim("<>") + chalk.white("   )"),
  smile:   chalk.white("  (   ") + chalk.dim("<>") + chalk.white("   )"),
  sad:     chalk.white("  (   ") + chalk.dim("..") + chalk.white("   )"),
  point:   chalk.white("  (   ") + chalk.dim("<>") + chalk.white("   )==>"),
};

const bodies: Record<string, string[]> = {
  standing: [
    chalk.white("  |\\  ") + chalk.dim("--") + chalk.white("  /|"),
    chalk.white("  | \\    / |"),
    chalk.white("   \\ \\||/ /"),
    chalk.white("    \\_||_/"),
    chalk.white("     |  |"),
  ],
  celebrate: [
    chalk.white("   \\  \\/  /"),
    chalk.white("    | \\/ |"),
    chalk.white("   /  ||  \\"),
    chalk.white("  /___||___\\"),
    chalk.white("  \\__/  \\__/"),
  ],
  confused: [
    chalk.white("  |\\  ") + chalk.dim("--") + chalk.white("  /|"),
    chalk.white("  | |    | |"),
    chalk.white("   \\ \\||/ /"),
    chalk.white("    \\_||_/") + chalk.dim("?"),
    chalk.white("     |  |"),
  ],
  help: [
    chalk.white("  |\\  ") + chalk.dim("--") + chalk.white("  /|"),
    chalk.white("  | |    | |"),
    chalk.white("   \\ \\||/ /"),
    chalk.white("    \\_||_/"),
    chalk.white("     |  |"),
  ],
};

// ---------------------------------------------------------------------------
// Pose assembly
// ---------------------------------------------------------------------------

function assembleFullPose(face: string, mouth: string, body: string[]): string {
  return [head, face, mouth, ...body].join("\n");
}

const fullPoses: Record<BearState, string> = {
  [BearState.greeting]: assembleFullPose(faces.neutral, mouths.normal, bodies.standing),
  [BearState.thinking]: chalk.dim("  (o.o) thinking..."),
  [BearState.success]:  assembleFullPose(faces.happy, mouths.smile, bodies.celebrate),
  [BearState.error]:    assembleFullPose(faces.confused, mouths.sad, bodies.confused),
  [BearState.help]:     assembleFullPose(faces.neutral, mouths.point, bodies.help),
};

// Compact single-line versions for narrow terminals
const compactPoses: Record<BearState, string> = {
  [BearState.greeting]: chalk.white("(o.o)"),
  [BearState.thinking]: chalk.dim("(o.o) thinking..."),
  [BearState.success]:  chalk.white("(^.^)") + " " + chalk.green("done!"),
  [BearState.error]:    chalk.white("(o.O)") + " " + chalk.red("uh oh"),
  [BearState.help]:     chalk.white("(o.o)>"),
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export function getBearArt(state: BearState, compact: boolean): string {
  return compact ? compactPoses[state] : fullPoses[state];
}

/** Raw (uncolored) art for snapshot testing with chalk.level=0. */
export { fullPoses, compactPoses };
