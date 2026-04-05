import { describe, it, expect, vi, afterEach } from "vitest";
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
  {
    name: "focused-review",
    description: "Review with interactive focus",
    triggerPhrases: [],
    promptTemplate: "Review for: {{ASK: What concern?}} — be thorough.",
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

describe("resolveSkillRouting — {{ASK:}} token handling in one-shot mode", () => {
  const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

  afterEach(() => {
    stderrSpy.mockClear();
  });

  it("strips {{ASK:}} tokens from the effective prompt in one-shot mode", () => {
    const result = resolveSkillRouting("/focused-review src/auth.ts", FIXTURE_SKILLS);
    expect(result.routedSkillName).toBe("focused-review");
    // Token should be gone from the prompt sent to the model
    expect(result.effectivePrompt).not.toContain("{{ASK:");
    expect(result.effectivePrompt).toContain("Review for:");
  });

  it("writes a warning to stderr when {{ASK:}} tokens are stripped", () => {
    resolveSkillRouting("/focused-review src/auth.ts", FIXTURE_SKILLS);
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("interactive"),
    );
  });

  it("does not write a warning when the skill has no {{ASK:}} tokens", () => {
    resolveSkillRouting("/review src/auth.ts", FIXTURE_SKILLS);
    expect(stderrSpy).not.toHaveBeenCalled();
  });
});
