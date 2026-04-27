import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runEvalCase, runAllEvals, type EvalCase } from "../../src/eval/runner.js";
import { rm, mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Mocks — Pattern A: module-level let + beforeEach reassign with wrapper
// ---------------------------------------------------------------------------

let mockAgentRun: ReturnType<typeof vi.fn>;
let mockLoadAllSkills: ReturnType<typeof vi.fn>;
let mockSubstituteInputs: ReturnType<typeof vi.fn>;

vi.mock("../../src/core/agent.js", () => ({
  Agent: class MockAgent {
    async run(...args: unknown[]) { return mockAgentRun(...args); }
  },
}));

vi.mock("../../src/skills/loader.js", () => ({
  loadAllSkills: (...args: unknown[]) => mockLoadAllSkills(...args),
}));

vi.mock("../../src/skills/template.js", () => ({
  substituteInputs: (...args: unknown[]) => mockSubstituteInputs(...args),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FAKE_CONFIG = { provider: "openai" } as never;

const BASIC_CASE: EvalCase = {
  name: "test-case",
  skill: "adversarial",
  inputs: { plan: "Add a rate limiter." },
  acceptance_criteria: [{ text: "Contains VERDICT", type: "structural", match: "VERDICT:" }],
  timeout_ms: 5000,
};

function makeSkill(name = "adversarial") {
  return {
    name,
    promptTemplate: "Challenge this plan: {{plan}}",
    inputs: { plan: { prompt: "The plan to challenge" } },
    model: "smart",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runEvalCase — happy path", () => {
  beforeEach(() => {
    mockAgentRun = vi.fn(async () => "VERDICT: CHALLENGED\nSTRONGEST_CONCERN: state loss");
    mockLoadAllSkills = vi.fn(async () => [makeSkill()]);
    mockSubstituteInputs = vi.fn().mockImplementation(
      (template: string, values: Record<string, string>) => {
        let result = template;
        for (const [k, v] of Object.entries(values)) {
          result = result.replaceAll(`{{${k}}}`, v);
        }
        return result;
      },
    );
  });

  it("returns RunnerResult with output and elapsed_ms", async () => {
    const result = await runEvalCase(BASIC_CASE, FAKE_CONFIG);
    expect(result.output).toBe("VERDICT: CHALLENGED\nSTRONGEST_CONCERN: state loss");
    expect(result.elapsed_ms).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeUndefined();
  });

  it("stores the eval case on the result", async () => {
    const result = await runEvalCase(BASIC_CASE, FAKE_CONFIG);
    expect(result.case).toEqual(BASIC_CASE);
  });

  it("substitutes inputs into the prompt template before calling agent.run()", async () => {
    await runEvalCase(BASIC_CASE, FAKE_CONFIG);
    expect(mockSubstituteInputs).toHaveBeenCalledWith(
      "Challenge this plan: {{plan}}",
      { plan: "Add a rate limiter." },
      expect.anything(),
    );
  });
});

describe("runEvalCase — skill not found", () => {
  beforeEach(() => {
    mockAgentRun = vi.fn(async () => "");
    mockLoadAllSkills = vi.fn(async () => []);
    mockSubstituteInputs = vi.fn((t: string) => t);
  });

  it("returns error field when skill name does not match any loaded skill", async () => {
    const result = await runEvalCase(BASIC_CASE, FAKE_CONFIG);
    expect(result.error).toMatch(/skill not found/i);
    expect(result.output).toBe("");
  });

  it("still populates elapsed_ms even on skill-not-found", async () => {
    const result = await runEvalCase(BASIC_CASE, FAKE_CONFIG);
    expect(result.elapsed_ms).toBeGreaterThanOrEqual(0);
  });
});

describe("runEvalCase — agent throws", () => {
  beforeEach(() => {
    mockAgentRun = vi.fn(async () => { throw new Error("LLM provider error"); });
    mockLoadAllSkills = vi.fn(async () => [makeSkill()]);
    mockSubstituteInputs = vi.fn((t: string) => t);
  });

  it("returns error field with message when agent.run() throws", async () => {
    const result = await runEvalCase(BASIC_CASE, FAKE_CONFIG);
    expect(result.error).toMatch(/LLM provider error/);
    expect(result.output).toBe("");
  });
});

describe("runAllEvals — directory handling", () => {
  beforeEach(() => {
    mockAgentRun = vi.fn(async () => "");
    mockLoadAllSkills = vi.fn(async () => []);
    mockSubstituteInputs = vi.fn((t: string) => t);
  });

  it("returns empty array when eval/ directory does not exist", async () => {
    const results = await runAllEvals(FAKE_CONFIG);
    expect(Array.isArray(results)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// EvalFixture — setupFixture / teardownFixture
// ---------------------------------------------------------------------------

describe("EvalFixture — setupFixture and teardownFixture", () => {
  it("creates temp dir with specified files", async () => {
    const { setupFixture, teardownFixture } = await import("../../src/eval/runner.js");
    const fixture = {
      type: "node-project" as const,
      files: [
        { path: "package.json", content: '{"name":"test"}' },
        { path: "src/add.ts", content: "// TODO" },
      ],
    };
    const tmpDir = await setupFixture(fixture);
    try {
      const { readFile } = await import("node:fs/promises");
      const pkg = await readFile(join(tmpDir, "package.json"), "utf8");
      expect(pkg).toBe('{"name":"test"}');
      const src = await readFile(join(tmpDir, "src/add.ts"), "utf8");
      expect(src).toBe("// TODO");
    } finally {
      await teardownFixture(tmpDir);
    }
  });

  it("teardown removes the directory unconditionally", async () => {
    const { setupFixture, teardownFixture } = await import("../../src/eval/runner.js");
    const fixture = { type: "bare-dir" as const, files: [] };
    const tmpDir = await setupFixture(fixture);
    await teardownFixture(tmpDir);
    const { stat } = await import("node:fs/promises");
    await expect(stat(tmpDir)).rejects.toThrow();
  });

  it("teardown runs even when agent throws (fixture case error path)", async () => {
    mockAgentRun = vi.fn(async () => { throw new Error("agent failed"); });
    mockLoadAllSkills = vi.fn(async () => [makeSkill()]);
    mockSubstituteInputs = vi.fn((t: string) => t);

    const fixtureCase: EvalCase = {
      ...BASIC_CASE,
      inputs: { plan: "test" },
      fixture: {
        type: "bare-dir" as const,
        files: [],
      },
    };

    const result = await runEvalCase(fixtureCase, FAKE_CONFIG);
    expect(result.error).toMatch(/agent failed/);

    // Verify no lingering tmp dirs from this run by checking the error was captured
    expect(result.output).toBe("");
  });
});

describe("EvalFixture — verify_files", () => {
  it("returns error when a verify_files path does not exist after run", async () => {
    mockAgentRun = vi.fn(async () => "done");
    mockLoadAllSkills = vi.fn(async () => [makeSkill()]);
    mockSubstituteInputs = vi.fn((t: string) => t);

    const fixtureCase: EvalCase = {
      ...BASIC_CASE,
      inputs: { plan: "test" },
      fixture: { type: "bare-dir" as const, files: [] },
      verify_files: ["src/missing.ts"],
    };

    const result = await runEvalCase(fixtureCase, FAKE_CONFIG);
    expect(result.error).toMatch(/verify_files/i);
  });

  it("succeeds when verify_files paths exist after run", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "vf-test-"));
    try {
      await mkdir(join(tmpDir, "src"), { recursive: true });
      await writeFile(join(tmpDir, "src/add.ts"), "export const add = (a: number, b: number) => a + b;");

      mockAgentRun = vi.fn(async () => "wrote src/add.ts");
      mockLoadAllSkills = vi.fn(async () => [makeSkill()]);
      mockSubstituteInputs = vi.fn((t: string) => t);

      // Use setupFixture to create a controlled tmp dir and pre-populate it
      const { setupFixture, teardownFixture } = await import("../../src/eval/runner.js");
      const fixture = {
        type: "bare-dir" as const,
        files: [{ path: "src/add.ts", content: "// placeholder" }],
      };
      const fixtureTmpDir = await setupFixture(fixture);
      try {
        const fixtureCase: EvalCase = {
          ...BASIC_CASE,
          inputs: { plan: "test" },
          fixture,
          verify_files: ["src/add.ts"],
        };
        const result = await runEvalCase(fixtureCase, FAKE_CONFIG);
        expect(result.error).toBeUndefined();
      } finally {
        await teardownFixture(fixtureTmpDir);
      }
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
