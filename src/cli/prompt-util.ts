/**
 * Shared readline wizard helpers.
 *
 * Provides a minimal prompt abstraction used by init.ts and spec-template.ts.
 * Extracted to avoid duplicating readline lifecycle logic.
 */

import { createInterface, type Interface } from "node:readline";

/**
 * Thrown when Ctrl+C is pressed during an ask() prompt.
 * Callers (init, :commit wizard) must catch this and treat it as cancellation.
 * The main REPL's SIGINT handler (session save + cleanup) fires independently.
 */
export class PromptInterrupt extends Error {
  constructor() {
    super("interrupted");
    this.name = "PromptInterrupt";
  }
}

/**
 * Create a readline interface bound to stdin/stdout.
 *
 * The caller is responsible for calling rl.close() when done.
 * SIGINT is handled in ask() via promise rejection — do NOT add a SIGINT
 * listener here, as process.exit() from readline SIGINT bypasses the REPL's
 * own handler that performs session save.
 */
export function createRl(): Interface {
  return createInterface({ input: process.stdin, output: process.stdout });
}

/**
 * Prompt the user with `question` and return their trimmed input.
 * Rejects with PromptInterrupt if the user presses Ctrl+C.
 */
export function ask(rl: Interface, question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const onSigint = () => {
      rl.close();
      reject(new PromptInterrupt());
    };
    rl.once("SIGINT", onSigint);
    rl.question(question, (a) => {
      rl.removeListener("SIGINT", onSigint);
      resolve(a.trim());
    });
  });
}
