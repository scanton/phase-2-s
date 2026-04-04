import { describe, it, expect } from "vitest";
import { loadSkillsFromDir } from "../../src/skills/loader.js";
import { join } from "node:path";

/**
 * Tests for the built-in /diff skill.
 * Verifies the skill loads correctly from .phase2s/skills/diff/ with
 * the expected triggers and non-empty prompt template.
 */
describe("/diff skill", () => {
  const skillsDir = join(process.cwd(), ".phase2s", "skills");

  it("loads the diff skill from .phase2s/skills/", async () => {
    const skills = await loadSkillsFromDir(skillsDir);
    const diff = skills.find((s) => s.name === "diff");
    expect(diff).toBeDefined();
  });

  it("has a non-empty description", async () => {
    const skills = await loadSkillsFromDir(skillsDir);
    const diff = skills.find((s) => s.name === "diff");
    expect(diff!.description).toBeTruthy();
    expect(diff!.description.length).toBeGreaterThan(0);
  });

  it("has trigger phrases including 'what changed'", async () => {
    const skills = await loadSkillsFromDir(skillsDir);
    const diff = skills.find((s) => s.name === "diff");
    expect(diff!.triggerPhrases).toContain("what changed");
  });

  it("has trigger phrases including 'review this diff'", async () => {
    const skills = await loadSkillsFromDir(skillsDir);
    const diff = skills.find((s) => s.name === "diff");
    expect(diff!.triggerPhrases).toContain("review this diff");
  });

  it("has a non-empty prompt template referencing git", async () => {
    const skills = await loadSkillsFromDir(skillsDir);
    const diff = skills.find((s) => s.name === "diff");
    expect(diff!.promptTemplate).toContain("git");
  });
});
