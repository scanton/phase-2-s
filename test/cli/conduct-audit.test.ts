/**
 * Tests for conduct-audit.ts
 *
 * Coverage:
 *  1. AUDIT_CASES — has exactly 10 entries
 *  2. AUDIT_CASES — all IDs are unique
 *  3. AUDIT_CASES — empty-goal case has expectFailure:true
 *  4. runConductAudit — passes when conductorGenSpec returns valid spec
 *  5. runConductAudit — fails when subtask count below minSubtasks
 *  6. runConductAudit — fails when subtask count exceeds maxSubtasks
 *  7. runConductAudit — fails when lintSpec returns ok:false
 *  8. runConductAudit — fails when required role is missing from spec
 *  9. runConductAudit — warns (non-fail) when expected keyword missing
 * 10. runConductAudit — empty-goal: conductorGenSpec returns sentinel → pass
 * 11. runConductAudit — empty-goal: conductorGenSpec throws → fail
 * 12. runConductAudit — empty-goal: conductorGenSpec returns non-empty path → fail
 * 13. runConductAudit — caseId filter runs only the specified case
 * 14. runConductAudit — caseId unknown throws with helpful message
 * 15. runConductAudit — conductorGenSpec throws → case fails with error message
 * 16. runConductAudit — conductorGenSpec returns empty specPath → case fails
 * 17. formatAuditResult — json:true emits parseable JSON
 * 18. formatAuditResult — non-JSON prints pass counts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockConductorGenSpec = vi.fn();
const mockLoadConfig = vi.fn(() => Promise.resolve({ provider: "openai", smart_model: "gpt-4o", fast_model: "gpt-4o-mini" }));
const mockParseSpec = vi.fn();
const mockLintSpec = vi.fn();

vi.mock("../../src/cli/conductor-prompt.js", () => ({
  conductorGenSpec: (...args: unknown[]) => mockConductorGenSpec(...args),
}));

vi.mock("../../src/core/config.js", () => ({
  loadConfig: () => mockLoadConfig(),
}));

vi.mock("../../src/core/spec-parser.js", () => ({
  parseSpec: (content: string) => mockParseSpec(content),
}));

vi.mock("../../src/cli/lint.js", () => ({
  lintSpec: (spec: unknown) => mockLintSpec(spec),
}));

import { AUDIT_CASES, runConductAudit, formatAuditResult } from "../../src/cli/conduct-audit.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSpec(subtasks: Array<{ name: string; role?: string }>) {
  return { decomposition: subtasks.map(st => ({ name: st.name, role: st.role })) };
}

function setupNormalCase(subtasks: Array<{ name: string; role?: string }>, lintOk = true) {
  mockConductorGenSpec.mockResolvedValue({ specPath: "/tmp/spec.md", specContent: "# spec" });
  mockParseSpec.mockReturnValue(makeSpec(subtasks));
  mockLintSpec.mockReturnValue({ ok: lintOk, issues: lintOk ? [] : [{ severity: "error", message: "missing field" }] });
}

// ---------------------------------------------------------------------------
// AUDIT_CASES static checks
// ---------------------------------------------------------------------------

describe("AUDIT_CASES", () => {
  it("has exactly 10 entries", () => {
    expect(AUDIT_CASES).toHaveLength(10);
  });

  it("all IDs are unique", () => {
    const ids = AUDIT_CASES.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("empty-goal case has expectFailure:true", () => {
    const emptyCase = AUDIT_CASES.find(c => c.id === "empty-goal");
    expect(emptyCase).toBeDefined();
    expect(emptyCase?.expectFailure).toBe(true);
    expect(emptyCase?.goal).toBe("");
  });
});

// ---------------------------------------------------------------------------
// runConductAudit
// ---------------------------------------------------------------------------

describe("runConductAudit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // suppress console output during tests
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes when conductorGenSpec returns a valid spec within bounds", async () => {
    setupNormalCase([
      { name: "Design the system", role: "architect" },
      { name: "Implement the thing", role: "implementer" },
    ]);
    const result = await runConductAudit({ caseId: "add-endpoint" });
    expect(result.passed).toBe(1);
    expect(result.total).toBe(1);
    expect(result.cases[0].passed).toBe(true);
  });

  it("fails when subtask count is below minSubtasks", async () => {
    mockConductorGenSpec.mockResolvedValue({ specPath: "/tmp/spec.md", specContent: "# spec" });
    mockParseSpec.mockReturnValue(makeSpec([{ name: "Only one task", role: "architect" }]));
    mockLintSpec.mockReturnValue({ ok: true, issues: [] });

    const result = await runConductAudit({ caseId: "add-endpoint" });
    expect(result.passed).toBe(0);
    expect(result.cases[0].passed).toBe(false);
    expect(result.cases[0].error).toMatch(/subtask count 1 < min 2/);
  });

  it("fails when subtask count exceeds maxSubtasks", async () => {
    mockConductorGenSpec.mockResolvedValue({ specPath: "/tmp/spec.md", specContent: "# spec" });
    // Produce 9 subtasks (max is 8)
    const tooMany = Array.from({ length: 9 }, (_, i) => ({ name: `Task ${i}`, role: "architect" }));
    mockParseSpec.mockReturnValue(makeSpec(tooMany));
    mockLintSpec.mockReturnValue({ ok: true, issues: [] });

    const result = await runConductAudit({ caseId: "add-endpoint" });
    expect(result.passed).toBe(0);
    expect(result.cases[0].error).toMatch(/subtask count 9 > max 8/);
  });

  it("fails when lintSpec returns ok:false", async () => {
    setupNormalCase(
      [{ name: "Design", role: "architect" }, { name: "Build", role: "implementer" }],
      false, // lintOk = false
    );
    const result = await runConductAudit({ caseId: "add-endpoint" });
    expect(result.passed).toBe(0);
    expect(result.cases[0].error).toMatch(/lintSpec failed/);
  });

  it("fails when required role is missing from spec", async () => {
    // auth-system requires architect AND reviewer
    setupNormalCase([
      { name: "Design auth", role: "architect" },
      { name: "Implement auth", role: "implementer" },
      { name: "Test auth", role: "tester" },
      // reviewer is missing
    ]);
    const result = await runConductAudit({ caseId: "auth-system" });
    expect(result.passed).toBe(0);
    expect(result.cases[0].error).toMatch(/required role "reviewer" not found/);
  });

  it("warns but does not fail when expected keyword is missing", async () => {
    setupNormalCase([
      { name: "Do something", role: "architect" }, // no "health" or "endpoint" keyword
      { name: "Do another thing", role: "implementer" },
    ]);
    const result = await runConductAudit({ caseId: "add-endpoint" });
    expect(result.passed).toBe(1);
    expect(result.cases[0].passed).toBe(true);
    expect(result.cases[0].warnings.length).toBeGreaterThan(0);
    expect(result.cases[0].warnings.some(w => w.includes("keyword"))).toBe(true);
  });

  it("empty-goal: conductorGenSpec returns sentinel { specPath:'', specContent:'' } → pass", async () => {
    mockConductorGenSpec.mockResolvedValue({ specPath: "", specContent: "" });
    const result = await runConductAudit({ caseId: "empty-goal" });
    expect(result.passed).toBe(1);
    expect(result.cases[0].passed).toBe(true);
  });

  it("empty-goal: conductorGenSpec throws → fail", async () => {
    mockConductorGenSpec.mockRejectedValue(new Error("LLM exploded"));
    const result = await runConductAudit({ caseId: "empty-goal" });
    expect(result.passed).toBe(0);
    expect(result.cases[0].error).toMatch(/LLM exploded/);
  });

  it("empty-goal: conductorGenSpec returns non-empty specPath → fail", async () => {
    mockConductorGenSpec.mockResolvedValue({ specPath: "/tmp/spec.md", specContent: "# something" });
    const result = await runConductAudit({ caseId: "empty-goal" });
    expect(result.passed).toBe(0);
    expect(result.cases[0].error).toMatch(/Expected graceful failure sentinel/);
  });

  it("caseId filter runs only the specified case", async () => {
    setupNormalCase([
      { name: "Design", role: "architect" },
      { name: "Build", role: "implementer" },
    ]);
    const result = await runConductAudit({ caseId: "add-endpoint" });
    expect(result.total).toBe(1);
    expect(result.cases[0].id).toBe("add-endpoint");
    expect(mockConductorGenSpec).toHaveBeenCalledTimes(1);
  });

  it("caseId unknown throws with helpful message", async () => {
    await expect(runConductAudit({ caseId: "does-not-exist" })).rejects.toThrow(
      /Unknown case id: "does-not-exist"/,
    );
  });

  it("conductorGenSpec throws → case fails with error message", async () => {
    mockConductorGenSpec.mockRejectedValue(new Error("timeout"));
    const result = await runConductAudit({ caseId: "add-endpoint" });
    expect(result.passed).toBe(0);
    expect(result.cases[0].error).toMatch(/conductorGenSpec threw: timeout/);
  });

  it("conductorGenSpec returns empty specPath → case fails", async () => {
    mockConductorGenSpec.mockResolvedValue({ specPath: "", specContent: "" });
    const result = await runConductAudit({ caseId: "add-endpoint" });
    expect(result.passed).toBe(0);
    expect(result.cases[0].error).toMatch(/empty specPath/);
  });
});

// ---------------------------------------------------------------------------
// formatAuditResult
// ---------------------------------------------------------------------------

describe("formatAuditResult", () => {
  let logLines: string[];

  beforeEach(() => {
    logLines = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logLines.push(args.map(a => String(a)).join(" "));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("json:true emits parseable JSON with expected shape", () => {
    const result = { cases: [{ id: "add-endpoint", goal: "goal", passed: true, durationMs: 1000, warnings: [] }], passed: 1, total: 1, avgDurationMs: 1000 };
    formatAuditResult(result, { json: true });
    const parsed = JSON.parse(logLines[0]);
    expect(parsed.passed).toBe(1);
    expect(parsed.total).toBe(1);
    expect(Array.isArray(parsed.cases)).toBe(true);
  });

  it("non-JSON prints pass counts and avg duration", () => {
    const result = {
      cases: [
        { id: "add-endpoint", goal: "goal", passed: true, durationMs: 2000, warnings: [] },
        { id: "auth-system", goal: "goal2", passed: false, durationMs: 3000, warnings: [], error: "lint failed" },
      ],
      passed: 1,
      total: 2,
      avgDurationMs: 2500,
    };
    formatAuditResult(result, { json: false });
    const output = logLines.join("\n");
    expect(output).toContain("1/2 passed");
    expect(output).toContain("Failures:");
    expect(output).toContain("auth-system");
    expect(output).toContain("lint failed");
  });
});
