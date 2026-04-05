/**
 * Bear mascot type definitions.
 *
 * BearState enum defines the moments the bear appears.
 * BearRenderer interface enables V1 (static print) and
 * V2 (animated pinned region) implementations.
 */

export enum BearState {
  greeting = "greeting",
  thinking = "thinking",
  success = "success",
  error = "error",
  help = "help",
}

export interface BearRenderer {
  render(state: BearState, message?: string): void;
}
