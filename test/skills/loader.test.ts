import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { loadSkillsFromDir } from "../../src/skills/loader.js";

describe("loadSkillsFromDir", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(process.cwd(), ".test-skills-"));
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true }).catch(() => {});
  });

  // --- Missing / empty directory ---

  it("returns [] for a non-existent directory", async () => {
    const skills = await loadSkillsFromDir(join(tmpDir, "no-such-dir"));
    expect(skills).toEqual([]);
  });

  it("returns [] for an empty directory", async () => {
    const emptyDir = join(tmpDir, "empty");
    await mkdir(emptyDir);
    const skills = await loadSkillsFromDir(emptyDir);
    expect(skills).toEqual([]);
  });

  // --- Directory-based skills (SKILL.md inside a folder) ---

  it("loads a skill from a directory containing SKILL.md", async () => {
    const skillDir = join(tmpDir, "greet");
    await mkdir(skillDir);
    await writeFile(
      join(skillDir, "SKILL.md"),
      `---\nname: greet\ndescription: Say hello\ntriggers: greet me, say hi\n---\nHello, {{target}}!\n`,
    );
    const skills = await loadSkillsFromDir(tmpDir);
    const greet = skills.find((s) => s.name === "greet");
    expect(greet).toBeDefined();
    expect(greet!.description).toBe("Say hello");
    expect(greet!.triggerPhrases).toContain("greet me");
    expect(greet!.triggerPhrases).toContain("say hi");
    expect(greet!.promptTemplate).toContain("Hello, {{target}}!");
  });

  it("sets sourcePath to the absolute SKILL.md path", async () => {
    const skillDir = join(tmpDir, "src-path-test");
    await mkdir(skillDir);
    await writeFile(
      join(skillDir, "SKILL.md"),
      `---\nname: src-path-test\ndescription: test\n---\ndo stuff\n`,
    );
    const skills = await loadSkillsFromDir(tmpDir);
    const skill = skills.find((s) => s.name === "src-path-test");
    expect(skill).toBeDefined();
    expect(skill!.sourcePath).toMatch(/SKILL\.md$/);
    expect(skill!.sourcePath.startsWith("/")).toBe(true);
  });

  // --- Flat .md file skills ---

  it("loads a skill from a flat .md file", async () => {
    const flatDir = join(tmpDir, "flat");
    await mkdir(flatDir);
    await writeFile(
      join(flatDir, "explain.md"),
      `---\nname: explain\ndescription: Explain code\ntriggers: explain this\n---\nExplain {{target}} in simple terms.\n`,
    );
    const skills = await loadSkillsFromDir(flatDir);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("explain");
    expect(skills[0].promptTemplate).toContain("{{target}}");
  });

  it("skips README.md files", async () => {
    const readmeDir = join(tmpDir, "readme-test");
    await mkdir(readmeDir);
    await writeFile(join(readmeDir, "README.md"), "# Skills\nNot a skill.");
    await writeFile(
      join(readmeDir, "real.md"),
      `---\nname: real\ndescription: A real skill\n---\nDo something.\n`,
    );
    const skills = await loadSkillsFromDir(readmeDir);
    expect(skills.map((s) => s.name)).not.toContain("README");
    expect(skills.find((s) => s.name === "real")).toBeDefined();
  });

  // --- Frontmatter edge cases ---

  it("handles YAML array triggers", async () => {
    const skillDir = join(tmpDir, "yaml-triggers");
    await mkdir(skillDir);
    await writeFile(
      join(skillDir, "SKILL.md"),
      `---\nname: yaml-triggers\ndescription: test\ntriggers:\n  - trigger one\n  - trigger two\n---\nDo it.\n`,
    );
    const skills = await loadSkillsFromDir(tmpDir);
    const skill = skills.find((s) => s.name === "yaml-triggers");
    expect(skill).toBeDefined();
    expect(skill!.triggerPhrases).toEqual(["trigger one", "trigger two"]);
  });

  it("loads skill with malformed frontmatter YAML (uses empty meta)", async () => {
    const skillDir = join(tmpDir, "malformed");
    await mkdir(skillDir);
    await writeFile(
      join(skillDir, "SKILL.md"),
      `---\n: bad: yaml: [unclosed\n---\nDo something.\n`,
    );
    const skills = await loadSkillsFromDir(tmpDir);
    const skill = skills.find((s) => s.name === "malformed");
    // Skill still loads (with empty meta) because promptTemplate is parsed separately
    expect(skill).toBeDefined();
    expect(skill!.name).toBe("malformed"); // falls back to directory name
    expect(skill!.promptTemplate).toContain("Do something.");
  });

  it("falls back to directory name when skill name is missing from frontmatter", async () => {
    const skillDir = join(tmpDir, "no-name-field");
    await mkdir(skillDir);
    await writeFile(
      join(skillDir, "SKILL.md"),
      `---\ndescription: No name in frontmatter\n---\nDo stuff.\n`,
    );
    const skills = await loadSkillsFromDir(tmpDir);
    const skill = skills.find((s) => s.name === "no-name-field");
    expect(skill).toBeDefined();
    expect(skill!.description).toBe("No name in frontmatter");
  });

  // --- Deduplication (via two calls, simulating loadAllSkills precedence) ---

  it("dedup: first-found name wins when merging two directories", async () => {
    const dirA = join(tmpDir, "dedup-a");
    const dirB = join(tmpDir, "dedup-b");
    await mkdir(join(dirA, "shared"), { recursive: true });
    await mkdir(join(dirB, "shared"), { recursive: true });

    // dirA has "shared" skill with description "from A"
    await writeFile(
      join(dirA, "shared", "SKILL.md"),
      `---\nname: shared\ndescription: from A\n---\nA prompt.\n`,
    );
    // dirB has "shared" skill with description "from B"
    await writeFile(
      join(dirB, "shared", "SKILL.md"),
      `---\nname: shared\ndescription: from B\n---\nB prompt.\n`,
    );

    const skillsA = await loadSkillsFromDir(dirA);
    const skillsB = await loadSkillsFromDir(dirB);

    // Merge with dedup — A wins
    const seen = new Set<string>();
    const merged = [];
    for (const skill of [...skillsA, ...skillsB]) {
      if (!seen.has(skill.name)) {
        seen.add(skill.name);
        merged.push(skill);
      }
    }

    const shared = merged.find((s) => s.name === "shared");
    expect(shared).toBeDefined();
    expect(shared!.description).toBe("from A");
  });
});
