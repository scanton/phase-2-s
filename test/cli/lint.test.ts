import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Spec } from "../../src/core/spec-parser.js";

// ---------------------------------------------------------------------------
// Mock child_process for async PATH checks in runLint()
// ---------------------------------------------------------------------------

const mockExecFile = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSpec(overrides: Partial<Spec> = {}): Spec {
  return {
    title: "My Feature",
    problemStatement: "Something is broken and users cannot do the thing.",
    decomposition: [
      {
        name: "Step 1",
        input: "source files",
        output: "fixed files",
        successCriteria: "tests pass",
      },
    ],
    acceptanceCriteria: ["Tests pass", "No regressions"],
    constraints: { mustDo: [], cannotDo: [], shouldPrefer: [], shouldEscalate: [] },
    evaluationDesign: [],
    evalCommand: "npm run test:custom",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// lintSpec
// ---------------------------------------------------------------------------

describe("lintSpec", () => {
  it("returns ok:true and no issues for a valid spec", async () => {
    const { lintSpec } = await import("../../src/cli/lint.js");
    const result = lintSpec(makeSpec());
    expect(result.ok).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("error: missing title (empty string)", async () => {
    const { lintSpec } = await import("../../src/cli/lint.js");
    const result = lintSpec(makeSpec({ title: "" }));
    expect(result.ok).toBe(false);
    const issue = result.issues.find((i) => i.message.includes("title"));
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("error");
  });

  it('error: title is "Untitled Spec"', async () => {
    const { lintSpec } = await import("../../src/cli/lint.js");
    const result = lintSpec(makeSpec({ title: "Untitled Spec" }));
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.severity === "error" && i.message.includes("title"))).toBe(true);
  });

  it("error: empty problemStatement", async () => {
    const { lintSpec } = await import("../../src/cli/lint.js");
    const result = lintSpec(makeSpec({ problemStatement: "   " }));
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.severity === "error" && i.message.includes("Problem Statement"))).toBe(true);
  });

  it("error: no decomposition sub-tasks", async () => {
    const { lintSpec } = await import("../../src/cli/lint.js");
    const result = lintSpec(makeSpec({ decomposition: [] }));
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.severity === "error" && i.message.includes("Decomposition"))).toBe(true);
  });

  it("error: no acceptance criteria", async () => {
    const { lintSpec } = await import("../../src/cli/lint.js");
    const result = lintSpec(makeSpec({ acceptanceCriteria: [] }));
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.severity === "error" && i.message.includes("Acceptance Criteria"))).toBe(true);
  });

  it('warn: evalCommand is default "npm test"', async () => {
    const { lintSpec } = await import("../../src/cli/lint.js");
    const result = lintSpec(makeSpec({ evalCommand: "npm test" }));
    // warnings don't affect ok
    expect(result.ok).toBe(true);
    expect(result.issues.some((i) => i.severity === "warn" && i.message.includes("evalCommand"))).toBe(true);
  });

  it("warn: subtask missing successCriteria", async () => {
    const { lintSpec } = await import("../../src/cli/lint.js");
    const result = lintSpec(
      makeSpec({
        decomposition: [{ name: "Step A", input: "x", output: "y", successCriteria: "" }],
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.issues.some((i) => i.severity === "warn" && i.message.includes("Step A"))).toBe(true);
  });

  it("accumulates multiple errors without short-circuiting", async () => {
    const { lintSpec } = await import("../../src/cli/lint.js");
    const result = lintSpec(
      makeSpec({ title: "", problemStatement: "", decomposition: [], acceptanceCriteria: [] }),
    );
    expect(result.ok).toBe(false);
    expect(result.issues.filter((i) => i.severity === "error").length).toBeGreaterThanOrEqual(4);
  });

  it("warn: spec has more than 8 sub-tasks", async () => {
    const { lintSpec } = await import("../../src/cli/lint.js");
    const manySubtasks = Array.from({ length: 9 }, (_, i) => ({
      name: `Step ${i + 1}`,
      input: "x",
      output: "y",
      successCriteria: "it works",
    }));
    const result = lintSpec(makeSpec({ decomposition: manySubtasks }));
    expect(result.ok).toBe(true); // warnings don't affect ok
    expect(result.issues.some((i) => i.severity === "warn" && i.message.includes("9 sub-tasks"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// runLint — evalCommand PATH check
// ---------------------------------------------------------------------------

describe("runLint — evalCommand PATH check", () => {
  beforeEach(() => {
    mockExecFile.mockReset();
    // Default: simulate "npm" always on PATH (avoids warnings for non-pytest specs)
    mockExecFile.mockImplementation((_cmd: unknown, _args: unknown, _opts: unknown, cb: (err: Error | null) => void) => cb(null));
  });

  it("warns when evalCommand uses a binary not on PATH", async () => {
    // Simulate "pytest" not found
    mockExecFile.mockImplementation((_cmd: unknown, _args: unknown, _opts: unknown, cb: (err: Error | null) => void) => cb(new Error("not found")));

    // Write a temp spec file
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const dir = join(tmpdir(), `lint-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const specPath = join(dir, "spec.md");
    const specMd = `# Test Spec\n\n## Problem Statement\nSomething broken needs fixing.\n\n## Decomposition\n### Sub-task 1: Fix it\n- **Input:** broken code\n- **Output:** working code\n- **Success criteria:** tests pass\n\n## Acceptance Criteria\n- Tests pass\n\n## Eval Command\n\`\`\`\npytest tests/\n\`\`\`\n`;
    writeFileSync(specPath, specMd, "utf8");

    const { runLint } = await import("../../src/cli/lint.js");
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const ok = await runLint(specPath);
    consoleSpy.mockRestore();

    // ok should still be true (PATH warning is advisory, not an error)
    expect(ok).toBe(true);
    // execFile should have been called with "which" and "pytest"
    const call = mockExecFile.mock.calls[0];
    expect(call[0]).toBe("which");
    expect(call[1]).toEqual(["pytest"]);
  });

  it("does not warn when evalCommand binary is on PATH", async () => {
    // Simulate "pytest" found
    mockExecFile.mockImplementation((_cmd: unknown, _args: unknown, _opts: unknown, cb: (err: Error | null) => void) => cb(null));

    const { writeFileSync, mkdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const dir = join(tmpdir(), `lint-test-found-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const specPath = join(dir, "spec.md");
    const specMd = `# Test Spec\n\n## Problem Statement\nSomething broken needs fixing.\n\n## Decomposition\n### Sub-task 1: Fix it\n- **Input:** broken code\n- **Output:** working code\n- **Success criteria:** tests pass\n\n## Acceptance Criteria\n- Tests pass\n\n## Eval Command\n\`\`\`\npytest tests/\n\`\`\`\n`;
    writeFileSync(specPath, specMd, "utf8");

    const { runLint } = await import("../../src/cli/lint.js");
    const logMessages: string[] = [];
    const consoleSpy = vi.spyOn(console, "log").mockImplementation((msg: unknown) => { logMessages.push(String(msg)); });
    await runLint(specPath);
    consoleSpy.mockRestore();

    // Should NOT have a PATH warning
    const hasPathWarn = logMessages.some((m) => m.includes("not found on PATH"));
    expect(hasPathWarn).toBe(false);
  });

  it("does not check PATH when evalCommand is default 'npm test'", async () => {
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const dir = join(tmpdir(), `lint-test-npmtest-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const specPath = join(dir, "spec.md");
    // evalCommand defaults to "npm test" when not specified
    writeFileSync(specPath, `# Test Spec\n\n## Problem Statement\nSomething broken needs fixing.\n\n## Decomposition\n### Sub-task 1: Fix it\n- **Input:** broken code\n- **Output:** working code\n- **Success criteria:** tests pass\n\n## Acceptance Criteria\n- Tests pass\n`, "utf8");

    const { runLint } = await import("../../src/cli/lint.js");
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await runLint(specPath);
    consoleSpy.mockRestore();

    // execFile should NOT have been called (npm test is skipped)
    expect(mockExecFile).not.toHaveBeenCalled();
  });
});
