import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";

/**
 * Codex provider structural hardening tests.
 *
 * We verify key security and correctness properties of codex.ts by inspecting
 * its source. We can't run codex in CI (not installed), so we test structure
 * statically and verify the implementation logic directly.
 */
describe("Codex provider hardening", () => {
  it("codex.ts contains the '--' end-of-flags separator before the prompt", async () => {
    const source = await readFile("src/providers/codex.ts", "utf-8");
    // The "--" element should appear in the args array
    expect(source).toContain('"--"');
    // It should come before the prompt variable in the args array
    const dashIdx = source.indexOf('"--"');
    const promptIdx = source.indexOf("prompt,", dashIdx);
    // The prompt argument should follow the "--" separator (in the same args array)
    expect(promptIdx).toBeGreaterThan(dashIdx);
  });

  it("codex.ts uses --json flag (required for non-interactive scripting mode)", async () => {
    const source = await readFile("src/providers/codex.ts", "utf-8");
    expect(source).toContain('"--json"');
  });

  it("codex.ts does NOT use --output-last-message (replaced by JSONL parsing)", async () => {
    const source = await readFile("src/providers/codex.ts", "utf-8");
    expect(source).not.toContain("--output-last-message");
  });

  it("codex.ts does NOT create temp directories (replaced by JSONL streaming)", async () => {
    const source = await readFile("src/providers/codex.ts", "utf-8");
    expect(source).not.toContain("mkdtemp");
    expect(source).not.toContain("activeTempDirs");
    expect(source).not.toContain("tmpdir()");
  });

  it("codex.ts JSONL parser silently skips malformed lines (JSON.parse in try/catch)", async () => {
    const source = await readFile("src/providers/codex.ts", "utf-8");
    // The processLine function should wrap JSON.parse in a try/catch
    const parseTry = source.indexOf("JSON.parse(line)");
    expect(parseTry).toBeGreaterThan(-1);
    // There should be a catch block after the parse
    const catchIdx = source.indexOf("} catch {", parseTry);
    expect(catchIdx).toBeGreaterThan(parseTry);
  });

  it("codex.ts uses async queue pattern with finish() guard against double-call", async () => {
    const source = await readFile("src/providers/codex.ts", "utf-8");
    expect(source).toContain("if (finished) return;");
  });

  it("codex.ts yields { type: 'done' } as the final event", async () => {
    const source = await readFile("src/providers/codex.ts", "utf-8");
    expect(source).toContain(`yield { type: "done", stopReason: "stop" }`);
  });
});
