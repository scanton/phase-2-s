import { describe, it, expect, vi, afterEach } from "vitest";
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

  it("respects the cwd option (within project directory)", async () => {
    // Use a subdirectory inside cwd so the sandbox allows it
    const result = await shellTool.execute({
      command: "pwd",
      cwd: "src",
    });
    expect(result.success).toBe(true);
    expect(result.output.trim()).toMatch(/src$/);
  });

  it("rejects cwd outside project directory", async () => {
    const result = await shellTool.execute({ command: "pwd", cwd: "/tmp" });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/outside project directory/);
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
  // The tool warns but does NOT block. Verify the warning fires AND the command still runs.

  it("emits a warning to stdout when a destructive pattern matches", async () => {
    const written: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });

    try {
      // "sudo" matches DESTRUCTIVE_PATTERNS — safe command but pattern triggers
      await shellTool.execute({ command: "echo 'would run: sudo ls'" });
    } finally {
      spy.mockRestore();
    }

    const output = written.join("");
    expect(output).toMatch(/Potentially destructive/);
    expect(output).toMatch(/\[shell\]/);
  });

  it("still executes the command after emitting a destructive warning", async () => {
    // Suppress the warning for this test
    const spy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    try {
      const result = await shellTool.execute({
        command: "echo 'would run: sudo ls'",
      });
      expect(result.success).toBe(true);
      expect(result.output).toContain("sudo ls");
    } finally {
      spy.mockRestore();
    }
  });
});
