import { describe, it, expect } from "vitest";
import type { Spec } from "../../src/core/spec-parser.js";

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
});
