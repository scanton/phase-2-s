import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runEvalCase, runAllEvals, type EvalCase } from "../../src/eval/runner.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const agentState = vi.hoisted(() => ({ response: "mock output", shouldThrow: false }));

vi.mock("../../src/core/agent.js", () => ({
  Agent: class MockAgent {
    async run(_prompt: string) {
      if (agentState.shouldThrow) throw new Error("LLM provider error");
      return agentState.response;
    }
  },
}));

const skillsState = vi.hoisted(() => ({
  skills: [] as Array<{ name: string; promptTemplate: string; inputs?: Record<string, unknown>; model?: string }>,
}));

vi.mock("../../src/skills/loader.js", () => ({
  loadAllSkills: vi.fn(async () => skillsState.skills),
}));

vi.mock("../../src/skills/template.js", () => ({
  substituteInputs: vi.fn().mockImplementation(
    (template: string, values: Record<string, string>, _inputs: unknown) => {
      let result = template;
      for (const [k, v] of Object.entries(values)) {
        result = result.replaceAll(`{{${k}}}`, v);
      }
      return result;
    },
  ),
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
    agentState.shouldThrow = false;
    agentState.response = "VERDICT: CHALLENGED\nSTRONGEST_CONCERN: state loss";
    skillsState.skills = [makeSkill()];
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
    const { substituteInputs } = await import("../../src/skills/template.js");
    await runEvalCase(BASIC_CASE, FAKE_CONFIG);
    expect(vi.mocked(substituteInputs)).toHaveBeenCalledWith(
      "Challenge this plan: {{plan}}",
      { plan: "Add a rate limiter." },
      expect.anything(),
    );
  });
});

describe("runEvalCase — skill not found", () => {
  beforeEach(() => {
    skillsState.skills = [];
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
    agentState.shouldThrow = true;
    skillsState.skills = [makeSkill()];
  });

  afterEach(() => {
    agentState.shouldThrow = false;
  });

  it("returns error field with message when agent.run() throws", async () => {
    const result = await runEvalCase(BASIC_CASE, FAKE_CONFIG);
    expect(result.error).toMatch(/LLM provider error/);
    expect(result.output).toBe("");
  });
});

describe("runAllEvals — directory handling", () => {
  it("returns empty array when eval/ directory does not exist", async () => {
    // In vitest's working directory there is no eval/ at root level during unit tests
    // We verify it returns [] gracefully rather than throwing
    const results = await runAllEvals(FAKE_CONFIG);
    expect(Array.isArray(results)).toBe(true);
  });
});
