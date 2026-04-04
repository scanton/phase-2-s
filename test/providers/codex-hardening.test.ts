import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";

/**
 * Codex arg injection hardening tests.
 *
 * We verify the source of codex.ts contains the "--" separator in the args array.
 * We can't run codex in CI (not installed), so we test the structure statically
 * and verify the logic directly.
 */
describe("Codex arg injection hardening", () => {
  it("codex.ts contains the '--' end-of-flags separator before the prompt", async () => {
    const source = await readFile("src/providers/codex.ts", "utf-8");
    // The "--" element should appear in the args array
    expect(source).toContain('"--"');
    // It should come before the prompt variable in the args array
    const dashIdx = source.indexOf('"--"');
    const promptIdx = source.indexOf("prompt,", dashIdx);
    // The prompt argument should follow the "--" separator (in the same args array)
    expect(promptIdx).toBeGreaterThan(dashIdx);
    // And the "--" should come after the outputFile arg (ensuring correct position)
    const outputFileIdx = source.lastIndexOf("outputFile", dashIdx);
    expect(outputFileIdx).toBeGreaterThan(-1);
    expect(outputFileIdx).toBeLessThan(dashIdx);
  });

  it("codex.ts registers SIGTERM handler for temp dir cleanup", async () => {
    const source = await readFile("src/providers/codex.ts", "utf-8");
    expect(source).toContain('process.on("SIGTERM"');
  });

  it("codex.ts registers SIGINT handler for temp dir cleanup", async () => {
    const source = await readFile("src/providers/codex.ts", "utf-8");
    expect(source).toContain('process.on("SIGINT"');
  });

  it("cleanupTempDirs function is extracted and reused by all signal handlers", async () => {
    const source = await readFile("src/providers/codex.ts", "utf-8");
    // Should define the function once and reference it multiple times
    const fnDef = source.indexOf("function cleanupTempDirs");
    expect(fnDef).toBeGreaterThan(-1);
    // All three handlers (exit, SIGTERM, SIGINT) should reference cleanupTempDirs
    const exitHandler = source.indexOf("cleanupTempDirs", source.indexOf('process.on("exit"'));
    const sigtermHandler = source.indexOf("cleanupTempDirs", source.indexOf('process.on("SIGTERM"'));
    const sigintHandler = source.indexOf("cleanupTempDirs", source.indexOf('process.on("SIGINT"'));
    expect(exitHandler).toBeGreaterThan(-1);
    expect(sigtermHandler).toBeGreaterThan(-1);
    expect(sigintHandler).toBeGreaterThan(-1);
  });

  it("codex.ts has signal handler guard flag to prevent double-registration", async () => {
    const source = await readFile("src/providers/codex.ts", "utf-8");
    // Should declare a guard variable
    expect(source).toContain("_signalHandlersRegistered");
    // The guard check should wrap the handler registration
    const guardIdx = source.indexOf("_signalHandlersRegistered");
    const ifIdx = source.indexOf("if (!_signalHandlersRegistered)", guardIdx - 5);
    expect(ifIdx).toBeGreaterThan(-1);
    // The process.on calls should appear after the guard check
    const exitIdx = source.indexOf('process.on("exit"', ifIdx);
    expect(exitIdx).toBeGreaterThan(ifIdx);
  });
});
