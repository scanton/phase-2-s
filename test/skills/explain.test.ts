/**
 * TDD: These tests are written BEFORE explain/SKILL.md exists.
 * They define the contract for the /explain skill.
 *
 * Run: npm test -- --reporter=verbose
 * All tests here should FAIL until SKILL.md is created.
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { loadSkillsFromDir } from "../../src/skills/loader.js";

describe("/explain skill", () => {
  const skillsDir = join(process.cwd(), ".phase2s", "skills");

  it("loads the explain skill from .phase2s/skills/", async () => {
    const skills = await loadSkillsFromDir(skillsDir);
    const explain = skills.find((s) => s.name === "explain");
    expect(explain).toBeDefined();
  });

  it("has the correct name", async () => {
    const skills = await loadSkillsFromDir(skillsDir);
    const explain = skills.find((s) => s.name === "explain");
    expect(explain!.name).toBe("explain");
  });

  it("has a non-empty description", async () => {
    const skills = await loadSkillsFromDir(skillsDir);
    const explain = skills.find((s) => s.name === "explain");
    expect(explain!.description.length).toBeGreaterThan(0);
  });

  it("has at least one trigger phrase", async () => {
    const skills = await loadSkillsFromDir(skillsDir);
    const explain = skills.find((s) => s.name === "explain");
    expect(explain!.triggerPhrases.length).toBeGreaterThan(0);
  });

  it("promptTemplate contains the {{target}} placeholder", async () => {
    const skills = await loadSkillsFromDir(skillsDir);
    const explain = skills.find((s) => s.name === "explain");
    expect(explain!.promptTemplate).toContain("{{target}}");
  });
});
