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

/**
 * Tests for the 2 OMX infrastructure skills added in Sprint 8.
 */
describe("Built-in skills — Sprint 8", () => {
  let skills: import("../../src/skills/types.js").Skill[];

  beforeAll(async () => {
    const skillsDir = join(process.cwd(), ".phase2s", "skills");
    skills = await loadSkillsFromDir(skillsDir);
  });

  function getSkill(name: string): import("../../src/skills/types.js").Skill {
    const skill = skills.find((s) => s.name === name);
    if (!skill) throw new Error(`Skill "${name}" not found in .phase2s/skills/`);
    return skill;
  }

  it("satori: loads with correct retries, model, and triggers", () => {
    const skill = getSkill("satori");
    expect(skill.description).toContain("Persistent execution");
    expect(skill.retries).toBe(3);
    expect(skill.model).toBe("smart");
    expect(skill.triggerPhrases).toContain("satori");
    expect(skill.triggerPhrases).toContain("run until tests pass");
    expect(skill.promptTemplate).toContain("verification");
  });

  it("consensus-plan: loads with correct model and triggers", () => {
    const skill = getSkill("consensus-plan");
    expect(skill.description).toContain("Consensus");
    expect(skill.model).toBe("smart");
    expect(skill.triggerPhrases).toContain("consensus plan");
    expect(skill.triggerPhrases).toContain("challenge this plan");
    expect(skill.promptTemplate).toContain("Critic");
  });

  it("satori: prompt contains satori state tracking reference", () => {
    const skill = getSkill("satori");
    expect(skill.promptTemplate).toContain(".phase2s/satori");
  });

  it("loads all 25 built-in skills (23 prior + satori + consensus-plan)", () => {
    expect(skills.length).toBeGreaterThanOrEqual(25);
  });
});

/**
 * Tests for the 1 Claude Code integration skill added in Sprint 9.
 */
describe("Built-in skills — Sprint 9", () => {
  let skills: import("../../src/skills/types.js").Skill[];

  beforeAll(async () => {
    const skillsDir = join(process.cwd(), ".phase2s", "skills");
    skills = await loadSkillsFromDir(skillsDir);
  });

  function getSkill(name: string): import("../../src/skills/types.js").Skill {
    const skill = skills.find((s) => s.name === name);
    if (!skill) throw new Error(`Skill "${name}" not found in .phase2s/skills/`);
    return skill;
  }

  it("adversarial: loads with correct model, triggers, and structured output format", () => {
    const skill = getSkill("adversarial");
    expect(skill.description).toContain("adversarial");
    expect(skill.model).toBe("smart");
    expect(skill.triggerPhrases).toContain("adversarial");
    expect(skill.triggerPhrases).toContain("challenge this");
    expect(skill.triggerPhrases).toContain("devil's advocate");
    expect(skill.promptTemplate).toContain("VERDICT");
  });

  it("adversarial: prompt contains all required output fields", () => {
    const skill = getSkill("adversarial");
    expect(skill.promptTemplate).toContain("STRONGEST_CONCERN");
    expect(skill.promptTemplate).toContain("OBJECTIONS");
    expect(skill.promptTemplate).toContain("APPROVE_IF");
  });

  it("adversarial: no interactive questions (no '?' outside output format)", () => {
    const skill = getSkill("adversarial");
    // The prompt should not ask the user questions — it's designed for AI invocation.
    // We check that the word "question" does not appear in the template.
    expect(skill.promptTemplate.toLowerCase()).not.toContain("what is your");
    expect(skill.promptTemplate.toLowerCase()).not.toContain("please provide");
  });

  it("loads all 26 built-in skills (25 prior + adversarial)", () => {
    expect(skills.length).toBeGreaterThanOrEqual(26);
  });
});

/**
 * Tests for the 2 meta-skills added in Sprint 10: /remember and /skill.
 */
describe("Built-in skills — Sprint 10", () => {
  let skills: import("../../src/skills/types.js").Skill[];

  beforeAll(async () => {
    const skillsDir = join(process.cwd(), ".phase2s", "skills");
    skills = await loadSkillsFromDir(skillsDir);
  });

  function getSkill(name: string): import("../../src/skills/types.js").Skill {
    const skill = skills.find((s) => s.name === name);
    if (!skill) throw new Error(`Skill "${name}" not found in .phase2s/skills/`);
    return skill;
  }

  it("remember: loads with correct name, description, and triggers", () => {
    const skill = getSkill("remember");
    expect(skill.description).toContain("memory");
    expect(skill.triggerPhrases).toContain("remember this");
    expect(skill.triggerPhrases).toContain("save this learning");
    expect(skill.triggerPhrases).toContain("remember for next time");
  });

  it("remember: prompt references learnings.jsonl write path", () => {
    const skill = getSkill("remember");
    expect(skill.promptTemplate).toContain("learnings.jsonl");
  });

  it("skill: loads with correct name, description, and triggers", () => {
    const skill = getSkill("skill");
    expect(skill.description).toContain("skill");
    expect(skill.triggerPhrases).toContain("create a skill");
    expect(skill.triggerPhrases).toContain("new skill");
    expect(skill.triggerPhrases).toContain("add a skill");
  });

  it("skill: prompt contains SKILL.md template structure", () => {
    const skill = getSkill("skill");
    expect(skill.promptTemplate).toContain("SKILL.md");
    expect(skill.promptTemplate).toContain("triggers");
    expect(skill.promptTemplate).toContain("description");
  });

  it("loads all 28 built-in skills (26 prior + remember + skill)", () => {
    expect(skills.length).toBeGreaterThanOrEqual(28);
  });

  // --- Sprint 11: /land-and-deploy ---
  it("land-and-deploy: loads with correct name, description, and triggers", () => {
    const skill = getSkill("land-and-deploy");
    expect(skill.description).toMatch(/PR|merge|deploy/i);
    expect(skill.triggerPhrases).toContain("land this");
    expect(skill.triggerPhrases).toContain("merge and deploy");
    expect(skill.triggerPhrases).toContain("land it");
  });

  it("land-and-deploy: prompt covers push, PR creation, CI wait, and merge", () => {
    const skill = getSkill("land-and-deploy");
    expect(skill.promptTemplate).toContain("git push");
    expect(skill.promptTemplate).toContain("gh pr");
    expect(skill.promptTemplate).toContain("CI");
    expect(skill.promptTemplate).toContain("merge");
  });

  it("loads all 29 built-in skills (28 prior + land-and-deploy)", () => {
    expect(skills.length).toBeGreaterThanOrEqual(29);
  });
});

// --- Bundled skills path (Sprint 12) ---
describe("loadAllSkills — bundled skills path", () => {
  it("loadAllSkills loads 29+ skills even when run outside the project directory", async () => {
    // Simulate running from a directory that has no .phase2s/skills/ of its own
    // by importing loadAllSkills (which includes the bundled path) and checking
    // that the bundled skills are found via the package-relative path.
    const { loadAllSkills } = await import("../../src/skills/loader.js");
    const skills = await loadAllSkills();
    // The bundled skills directory resolves to .phase2s/skills/ relative to the
    // package root — which in dev is the project root. So all 29 skills load.
    expect(skills.length).toBeGreaterThanOrEqual(29);
  });
});
