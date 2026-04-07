/**
 * Shared readline wizard helpers.
 *
 * Provides a minimal prompt abstraction used by init.ts and spec-template.ts.
 * Extracted to avoid duplicating readline lifecycle logic.
 */

import { createInterface, type Interface } from "node:readline";

/**
 * Create a readline interface bound to stdin/stdout.
 *
 * The caller is responsible for calling rl.close() when done.
 * SIGINT handling: registers a one-time listener that closes rl and exits.
 */
export function createRl(): Interface {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.on("SIGINT", () => {
    rl.close();
    process.exit(0);
  });
  return rl;
}

/**
 * Prompt the user with `question` and return their trimmed input.
 */
export function ask(rl: Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, (a) => resolve(a.trim())));
}
