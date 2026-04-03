import { describe, it, expect } from "vitest";
import { shellTool } from "../../src/tools/shell.js";

describe("shell", () => {
  // --- Happy path ---

  it("runs a basic command and returns stdout", async () => {
    const result = await shellTool.execute({ command: "echo hello" });
    expect(result.success).toBe(true);
    expect(result.output).toContain("hello");
  });

  it("captures stdout and stderr separately", async () => {
    const result = await shellTool.execute({
      command: "echo out && echo err >&2",
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain("out");
    expect(result.output).toContain("[stderr]");
    expect(result.output).toContain("err");
  });

  it("returns success: false for non-zero exit", async () => {
    const result = await shellTool.execute({ command: "exit 1" });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/code 1/);
  });

  it("captures stdout even on non-zero exit", async () => {
    const result = await shellTool.execute({
      command: "echo partial && exit 1",
    });
    expect(result.success).toBe(false);
    expect(result.output).toContain("partial");
  });

  it("returns (no output) when command produces nothing", async () => {
    const result = await shellTool.execute({ command: "true" });
    expect(result.success).toBe(true);
    expect(result.output).toBe("(no output)");
  });

  it("respects the cwd option", async () => {
    const result = await shellTool.execute({
      command: "pwd",
      cwd: "/tmp",
    });
    expect(result.success).toBe(true);
    // /tmp resolves to /private/tmp on macOS via symlink
    expect(result.output.trim()).toMatch(/\/tmp$/);
  });

  // --- Timeout ---

  it("times out a slow command", async () => {
    const result = await shellTool.execute({
      command: "sleep 10",
      timeout: 1_000,
    });
    expect(result.success).toBe(false);
  }, 5_000);

  // --- Schema validation ---

  it("rejects timeout below minimum (1000ms)", async () => {
    await expect(
      shellTool.execute({ command: "echo hi", timeout: 100 }),
    ).rejects.toThrow();
  });

  it("rejects timeout above maximum (300000ms)", async () => {
    await expect(
      shellTool.execute({ command: "echo hi", timeout: 999_999 }),
    ).rejects.toThrow();
  });

  // --- Destructive pattern detection ---
  // The tool warns but does NOT block. We verify the command still runs (returns a result).
  // The warning is a stdout side-effect visible to the human user, not the LLM.

  it("still executes when a potentially destructive pattern is present", async () => {
    // Use a safe echo that contains the pattern string — the tool checks args.command itself
    // so we pass a real command that matches but is harmless (echo doesn't destroy anything)
    const result = await shellTool.execute({
      command: "echo 'would run: sudo ls'",
    });
    // The command string contains "sudo" — warning fires, but command still runs
    expect(result).toBeDefined();
    expect(result.output).toContain("sudo ls");
  });
});
