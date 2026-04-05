import { describe, it, expect } from "vitest";
import { resolveSkillRouting } from "../../src/cli/index.js";
import type { Skill } from "../../src/skills/types.js";

const FIXTURE_SKILLS: Skill[] = [
  {
    name: "explain",
    description: "Explain code",
    triggerPhrases: [],
    promptTemplate: "Explain {{target}}.",
    model: "fast",
  },
  {
    name: "review",
    description: "Code review",
    triggerPhrases: [],
    promptTemplate: "Review the code.",
    model: "smart",
  },
];

describe("resolveSkillRouting — Sprint 15 one-shot routing", () => {
  it("/explain foo routes through explain skill with model override", () => {
    const result = resolveSkillRouting("/explain src/auth.ts", FIXTURE_SKILLS);
    expect(result.routedSkillName).toBe("explain");
    expect(result.modelOverride).toBe("fast");
    expect(result.effectivePrompt).toContain("Explain");
    expect(result.unknownSkillName).toBeNull();
  });

  it("plain prompt is unchanged and returns no routing fields", () => {
    const result = resolveSkillRouting("what does this code do?", FIXTURE_SKILLS);
    expect(result.effectivePrompt).toBe("what does this code do?");
    expect(result.routedSkillName).toBeNull();
    expect(result.unknownSkillName).toBeNull();
    expect(result.modelOverride).toBeUndefined();
  });

  it("/unknown-skill returns unknownSkillName and prompt unchanged", () => {
    const result = resolveSkillRouting("/typo-skill foo", FIXTURE_SKILLS);
    expect(result.unknownSkillName).toBe("typo-skill");
    expect(result.routedSkillName).toBeNull();
    expect(result.effectivePrompt).toBe("/typo-skill foo");
  });
});
