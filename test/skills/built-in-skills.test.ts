import { describe, it, expect, beforeAll } from "vitest";
import { join } from "node:path";
import { loadSkillsFromDir } from "../../src/skills/loader.js";
import type { Skill } from "../../src/skills/types.js";

/**
 * Tests for the 11 new built-in skills added in Sprint 6.
 *
 * These tests load the actual SKILL.md files from .phase2s/skills/ and verify
 * that each skill has the correct name, description, and triggers.
 */
describe("Built-in skills — Sprint 6", () => {
  let skills: Skill[];

  beforeAll(async () => {
    const skillsDir = join(process.cwd(), ".phase2s", "skills");
    skills = await loadSkillsFromDir(skillsDir);
  });

  function getSkill(name: string): Skill {
    const skill = skills.find((s) => s.name === name);
    if (!skill) throw new Error(`Skill "${name}" not found in .phase2s/skills/`);
    return skill;
  }

  // --- Dev Workflow Ops ---

  it("retro: loads with correct triggers", () => {
    const skill = getSkill("retro");
    expect(skill.description).toContain("retrospective");
    expect(skill.triggerPhrases).toContain("weekly retro");
    expect(skill.triggerPhrases).toContain("what did we ship");
    expect(skill.promptTemplate).toContain("git log");
  });

  it("health: loads with correct triggers", () => {
    const skill = getSkill("health");
    expect(skill.description).toContain("quality");
    expect(skill.triggerPhrases).toContain("health check");
    expect(skill.triggerPhrases).toContain("code quality");
    expect(skill.promptTemplate).toContain("npm test");
  });

  it("checkpoint: loads with correct triggers", () => {
    const skill = getSkill("checkpoint");
    expect(skill.description).toContain("session");
    expect(skill.triggerPhrases).toContain("checkpoint");
    expect(skill.triggerPhrases).toContain("save progress");
    expect(skill.promptTemplate).toContain(".phase2s/checkpoints");
  });

  // --- Security & Audit ---

  it("audit: loads with correct triggers", () => {
    const skill = getSkill("audit");
    expect(skill.description.toLowerCase()).toContain("security");
    expect(skill.triggerPhrases).toContain("security audit");
    expect(skill.triggerPhrases).toContain("audit");
    expect(skill.promptTemplate).toContain("secrets");
  });

  // --- Plan Review Pipeline ---

  it("plan-review: loads with correct triggers", () => {
    const skill = getSkill("plan-review");
    expect(skill.description).toContain("plan");
    expect(skill.triggerPhrases).toContain("plan review");
    expect(skill.triggerPhrases).toContain("engineering review");
    expect(skill.promptTemplate).toContain("Section");
  });

  it("scope-review: loads with correct triggers", () => {
    const skill = getSkill("scope-review");
    expect(skill.description.toLowerCase()).toContain("scope");
    expect(skill.triggerPhrases).toContain("scope review");
    expect(skill.triggerPhrases).toContain("think bigger");
    expect(skill.promptTemplate).toContain("mode");
  });

  it("autoplan: loads with correct triggers", () => {
    const skill = getSkill("autoplan");
    expect(skill.description).toContain("review");
    expect(skill.triggerPhrases).toContain("autoplan");
    expect(skill.triggerPhrases).toContain("full plan review");
    expect(skill.promptTemplate).toContain("Completeness");
  });

  // --- Safety Skills ---

  it("careful: loads with correct triggers", () => {
    const skill = getSkill("careful");
    expect(skill.description).toContain("safety");
    expect(skill.triggerPhrases).toContain("careful");
    expect(skill.triggerPhrases).toContain("safety mode");
    expect(skill.promptTemplate).toContain("destructive");
  });

  it("freeze: loads with correct triggers", () => {
    const skill = getSkill("freeze");
    expect(skill.description).toContain("directory");
    expect(skill.triggerPhrases).toContain("freeze");
    expect(skill.triggerPhrases).toContain("restrict edits");
    expect(skill.promptTemplate).toContain("boundary");
  });

  it("guard: loads with correct triggers", () => {
    const skill = getSkill("guard");
    expect(skill.description).toContain("safety");
    expect(skill.triggerPhrases).toContain("guard");
    expect(skill.triggerPhrases).toContain("full safety");
    expect(skill.promptTemplate).toContain("destructive");
  });

  it("unfreeze: loads with correct triggers", () => {
    const skill = getSkill("unfreeze");
    expect(skill.description).toContain("edit");
    expect(skill.triggerPhrases).toContain("unfreeze");
    expect(skill.triggerPhrases).toContain("unlock edits");
    expect(skill.promptTemplate).toContain("restriction");
  });

  // --- Sanity: total skill count ---

  it("loads all 18 built-in skills (7 original + 11 new)", () => {
    // Original: review, investigate, plan, ship, qa, explain, diff
    // New: retro, health, audit, plan-review, checkpoint, scope-review,
    //      careful, freeze, guard, unfreeze, autoplan
    expect(skills.length).toBeGreaterThanOrEqual(18);
  });
});

/**
 * Tests for the 5 execution skills added in Sprint 7.
 */
describe("Built-in skills — Sprint 7", () => {
  let skills: Skill[];

  beforeAll(async () => {
    const skillsDir = join(process.cwd(), ".phase2s", "skills");
    skills = await loadSkillsFromDir(skillsDir);
  });

  function getSkill(name: string): Skill {
    const skill = skills.find((s) => s.name === name);
    if (!skill) throw new Error(`Skill "${name}" not found in .phase2s/skills/`);
    return skill;
  }

  // --- Execution skills ---

  it("debug: loads with correct triggers", () => {
    const skill = getSkill("debug");
    expect(skill.description.toLowerCase()).toContain("debug");
    expect(skill.triggerPhrases).toContain("debug");
    expect(skill.triggerPhrases).toContain("fix this bug");
    expect(skill.promptTemplate).toContain("isolate");
    expect(skill.promptTemplate).toContain("reproduce");
  });

  it("tdd: loads with correct triggers", () => {
    const skill = getSkill("tdd");
    expect(skill.description.toLowerCase()).toContain("test");
    expect(skill.triggerPhrases).toContain("tdd");
    expect(skill.triggerPhrases).toContain("test driven");
    expect(skill.promptTemplate).toContain("Red");
    expect(skill.promptTemplate).toContain("Green");
  });

  it("slop-clean: loads with correct triggers", () => {
    const skill = getSkill("slop-clean");
    expect(skill.description.toLowerCase()).toMatch(/refactor|clean/);
    expect(skill.triggerPhrases).toContain("clean");
    expect(skill.triggerPhrases).toContain("refactor");
    expect(skill.promptTemplate).toContain("smell");
    expect(skill.promptTemplate).toContain("Duplication");
  });

  it("deep-specify: loads with correct triggers", () => {
    const skill = getSkill("deep-specify");
    expect(skill.description.toLowerCase()).toMatch(/spec|clarif|ambig/);
    expect(skill.triggerPhrases).toContain("deep specify");
    expect(skill.triggerPhrases).toContain("clarify");
    expect(skill.promptTemplate).toContain("NON-GOALS");
    expect(skill.promptTemplate).toContain("spec");
  });

  it("docs: loads with correct triggers", () => {
    const skill = getSkill("docs");
    expect(skill.description.toLowerCase()).toContain("doc");
    expect(skill.triggerPhrases).toContain("docs");
    expect(skill.triggerPhrases).toContain("jsdoc");
    expect(skill.promptTemplate).toContain("JSDoc");
    expect(skill.promptTemplate).toContain("@param");
  });

  // --- Sanity: total skill count ---

  it("loads all 23 built-in skills (18 prior + 5 new execution skills)", () => {
    // Prior 18: review, investigate, plan, ship, qa, explain, diff,
    //           retro, health, audit, plan-review, checkpoint, scope-review,
    //           careful, freeze, guard, unfreeze, autoplan
    // New 5: debug, tdd, clean, deep-specify, docs
    expect(skills.length).toBeGreaterThanOrEqual(23);
  });
});
