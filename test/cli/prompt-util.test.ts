import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { ask, PromptInterrupt } from "../../src/cli/prompt-util.js";

// Minimal readline Interface stub — just enough for ask() to work.
function makeStubRl(answer?: string) {
  const emitter = new EventEmitter() as EventEmitter & {
    question: (q: string, cb: (a: string) => void) => void;
    close: () => void;
    removeListener: (event: string, fn: (...args: unknown[]) => void) => EventEmitter;
  };
  emitter.question = (_q: string, cb: (a: string) => void) => {
    if (answer !== undefined) cb(answer);
  };
  emitter.close = vi.fn();
  return emitter;
}

describe("ask()", () => {
  it("resolves with trimmed input on normal answer", async () => {
    const rl = makeStubRl("  hello world  ");
    const result = await ask(rl as never, "Prompt: ");
    expect(result).toBe("hello world");
  });

  it("rejects with PromptInterrupt on SIGINT, does not call process.exit", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);

    const rl = makeStubRl(); // no answer — will hang until SIGINT
    const pending = ask(rl as never, "Prompt: ");

    // Simulate Ctrl+C by emitting SIGINT on the rl
    rl.emit("SIGINT");

    await expect(pending).rejects.toBeInstanceOf(PromptInterrupt);
    expect(exitSpy).not.toHaveBeenCalled();

    exitSpy.mockRestore();
  });
});

describe("PromptInterrupt", () => {
  it("is an Error with name PromptInterrupt", () => {
    const err = new PromptInterrupt();
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("PromptInterrupt");
    expect(err.message).toBe("interrupted");
  });
});
