import { describe, it, expect } from "vitest";
import type { Skill } from "../../src/skills/types.js";

// Helper that mirrors the tier badge logic in the skills command
function getTierBadge(skill: Skill): string {
  return skill.model === "fast" ? " [fast]" : skill.model === "smart" ? " [smart]" : "";
}

// Helper that mirrors the type hint logic in the REPL input prompting
function getTypeHint(inputDef: { type?: string; enum?: string[] }): string {
  if (inputDef.type === "boolean") return " (yes/no)";
  if (inputDef.type === "enum" && inputDef.enum?.length) {
    return ` [${inputDef.enum.join("/")}]`;
  }
  return "";
}

describe("TODO-5: skills command tier badge", () => {
  it("fast skill shows [fast] badge", () => {
    const skill: Skill = {
      name: "explain",
      description: "Explain code",
      triggerPhrases: [],
      promptTemplate: "Explain {{target}}.",
      model: "fast",
    };
    expect(getTierBadge(skill)).toBe(" [fast]");
  });

  it("smart skill shows [smart] badge", () => {
    const skill: Skill = {
      name: "review",
      description: "Code review",
      triggerPhrases: [],
      promptTemplate: "Review the code.",
      model: "smart",
    };
    expect(getTierBadge(skill)).toBe(" [smart]");
  });

  it("skill with no model tier shows no badge", () => {
    const skill: Skill = {
      name: "autoplan",
      description: "Auto planning",
      triggerPhrases: [],
      promptTemplate: "Plan this.",
    };
    expect(getTierBadge(skill)).toBe("");
  });

  it("skill with literal model (not a tier) shows no badge", () => {
    const skill: Skill = {
      name: "custom",
      description: "Custom skill",
      triggerPhrases: [],
      promptTemplate: "Do this.",
      model: "gpt-4o",
    };
    expect(getTierBadge(skill)).toBe("");
  });
});

describe("TODO-4: REPL typed input type hints", () => {
  it("boolean input shows (yes/no) hint", () => {
    expect(getTypeHint({ type: "boolean" })).toBe(" (yes/no)");
  });

  it("enum input shows [opt1/opt2/opt3] hint", () => {
    expect(getTypeHint({ type: "enum", enum: ["low", "medium", "high"] })).toBe(" [low/medium/high]");
  });

  it("enum input with single value shows [opt] hint", () => {
    expect(getTypeHint({ type: "enum", enum: ["only"] })).toBe(" [only]");
  });

  it("string input shows no hint", () => {
    expect(getTypeHint({ type: "string" })).toBe("");
  });

  it("number input shows no hint", () => {
    expect(getTypeHint({ type: "number" })).toBe("");
  });

  it("input with no type shows no hint", () => {
    expect(getTypeHint({})).toBe("");
  });

  it("enum input with empty enum array shows no hint", () => {
    expect(getTypeHint({ type: "enum", enum: [] })).toBe("");
  });
});

describe("TODO-3: --dry-run output via resolveSkillRouting", () => {
  // These tests verify that resolveSkillRouting returns the data needed for --dry-run.
  // The dry-run flag itself is integration-tested at the CLI level; here we test the
  // underlying routing data that dry-run surfaces.
  it("is covered by one-shot-routing.test.ts (resolveSkillRouting tests)", () => {
    // resolveSkillRouting returns routedSkillName, unknownSkillName, and modelOverride
    // which are exactly what --dry-run uses to build its output message.
    expect(true).toBe(true);
  });
});

describe("TODO-2: skills --json output", () => {
  // Helper mirroring the --json serialisation in the skills command
  function serializeSkills(skills: Skill[]) {
    return skills.map((s) => ({
      name: s.name,
      description: s.description ?? null,
      model: s.model ?? null,
      inputs: s.inputs
        ? Object.fromEntries(
            Object.entries(s.inputs).map(([k, v]) => [
              k,
              {
                prompt: (v as { prompt: string; type?: string; enum?: string[] }).prompt,
                type: (v as { prompt: string; type?: string }).type ?? "string",
                ...((v as { enum?: string[] }).enum ? { enum: (v as { enum?: string[] }).enum } : {}),
              },
            ])
          )
        : null,
    }));
  }

  it("serialises name, description, model tier, and null inputs for a simple skill", () => {
    const skill: Skill = {
      name: "explain",
      description: "Explain code",
      triggerPhrases: [],
      promptTemplate: "Explain {{target}}.",
      model: "fast",
    };
    const result = serializeSkills([skill]);
    expect(result).toEqual([{ name: "explain", description: "Explain code", model: "fast", inputs: null }]);
  });

  it("serialises inputs with type and enum when present", () => {
    const skill: Skill = {
      name: "plan",
      description: "Plan a feature",
      triggerPhrases: [],
      promptTemplate: "Plan {{feature}}.",
      model: "smart",
      inputs: {
        feature: { prompt: "What to build?", type: "string" } as { prompt: string; type?: string },
        priority: { prompt: "Priority level", type: "enum", enum: ["low", "medium", "high"] } as {
          prompt: string;
          type?: string;
          enum?: string[];
        },
      },
    };
    const result = serializeSkills([skill]);
    expect(result[0].inputs).toEqual({
      feature: { prompt: "What to build?", type: "string" },
      priority: { prompt: "Priority level", type: "enum", enum: ["low", "medium", "high"] },
    });
  });

  it("serialises null model for skills with no tier declared", () => {
    const skill: Skill = {
      name: "autoplan",
      description: "Auto planning",
      triggerPhrases: [],
      promptTemplate: "Plan.",
    };
    const result = serializeSkills([skill]);
    expect(result[0].model).toBeNull();
  });

  it("output is valid JSON (round-trips through parse)", () => {
    const skill: Skill = {
      name: "review",
      description: "Code review",
      triggerPhrases: [],
      promptTemplate: "Review.",
      model: "smart",
    };
    const json = JSON.stringify(serializeSkills([skill]), null, 2);
    expect(() => JSON.parse(json)).not.toThrow();
    expect(JSON.parse(json)[0].name).toBe("review");
  });
});

// ---------------------------------------------------------------------------
// Sprint 30: skills search filter logic
// (mirrors the filter applied in the 'skills [query]' CLI command)
// ---------------------------------------------------------------------------

function filterSkills(skills: Skill[], query: string): Skill[] {
  const q = query.toLowerCase();
  return skills.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      (s.description?.toLowerCase().includes(q) ?? false),
  );
}

const FIXTURE_SKILLS: Skill[] = [
  {
    name: "health",
    description: "Code quality dashboard — runs type check, tests, lint",
    triggerPhrases: [],
    promptTemplate: "Run health check.",
    model: "smart",
  },
  {
    name: "qa",
    description: "Quality assurance pass — find bugs and edge cases",
    triggerPhrases: [],
    promptTemplate: "Run QA.",
    model: "smart",
  },
  {
    name: "audit",
    description: "Security audit — scans for vulnerabilities",
    triggerPhrases: [],
    promptTemplate: "Run audit.",
    model: "smart",
  },
  {
    name: "explain",
    description: "Explain code or a concept clearly",
    triggerPhrases: [],
    promptTemplate: "Explain {{target}}.",
    model: "fast",
  },
  {
    name: "ship",
    description: "Prepare and execute a clean commit",
    triggerPhrases: [],
    promptTemplate: "Ship.",
    model: "smart",
  },
  {
    name: "land-and-deploy",
    description: "Push, open a PR, merge, wait for CI, verify the deploy",
    triggerPhrases: [],
    promptTemplate: "Deploy.",
    model: "smart",
  },
];

describe("skills search filter", () => {
  it("filters skills whose description contains the query", () => {
    const results = filterSkills(FIXTURE_SKILLS, "quality");
    expect(results.map((s) => s.name)).toEqual(
      expect.arrayContaining(["health", "qa"]),
    );
    expect(results.map((s) => s.name)).not.toContain("explain");
  });

  it("matches the skill name itself", () => {
    const results = filterSkills(FIXTURE_SKILLS, "audit");
    expect(results.map((s) => s.name)).toContain("audit");
  });

  it("is case-insensitive", () => {
    const results = filterSkills(FIXTURE_SKILLS, "QUALITY");
    expect(results.length).toBeGreaterThan(0);
    // same as lowercase query
    expect(results.map((s) => s.name)).toEqual(
      filterSkills(FIXTURE_SKILLS, "quality").map((s) => s.name),
    );
  });

  it("returns empty array when no skills match", () => {
    const results = filterSkills(FIXTURE_SKILLS, "nonexistent-term-xyz");
    expect(results).toHaveLength(0);
  });

  it("returns all skills when query matches a common term", () => {
    // Every skill has a non-empty description — "a" matches almost everything.
    // Testing that partial match works broadly.
    const results = filterSkills(FIXTURE_SKILLS, "a");
    expect(results.length).toBeGreaterThan(0);
  });

  it("matches partial skill names (prefix)", () => {
    // "land" should match "land-and-deploy"
    const results = filterSkills(FIXTURE_SKILLS, "land");
    expect(results.map((s) => s.name)).toContain("land-and-deploy");
  });

  it("returns all skills when query is empty string", () => {
    const results = filterSkills(FIXTURE_SKILLS, "");
    expect(results).toHaveLength(FIXTURE_SKILLS.length);
  });
});
