import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Skill } from "./types.js";

/**
 * Load skills from SKILL.md files in a directory.
 *
 * Follows a convention similar to gstack: each skill is a directory
 * containing a SKILL.md file with YAML-like frontmatter.
 */
export async function loadSkillsFromDir(dir: string): Promise<Skill[]> {
  const skills: Skill[] = [];
  const absDir = resolve(dir);

  let entries: string[];
  try {
    entries = await readdir(absDir);
  } catch {
    return skills;
  }

  for (const entry of entries) {
    const entryPath = join(absDir, entry);
    const entryStat = await stat(entryPath).catch(() => null);

    if (entryStat?.isDirectory()) {
      // Look for SKILL.md inside the directory
      const skillPath = join(entryPath, "SKILL.md");
      const skill = await parseSkillFile(skillPath);
      if (skill) {
        skill.name = skill.name || entry;
        skills.push(skill);
      }
    } else if (entry.endsWith(".md") && entry !== "README.md") {
      // Also support flat .md files as skills
      const skill = await parseSkillFile(entryPath);
      if (skill) {
        skill.name = skill.name || entry.replace(".md", "");
        skills.push(skill);
      }
    }
  }

  return skills;
}

async function parseSkillFile(path: string): Promise<Skill | null> {
  let content: string;
  try {
    content = await readFile(path, "utf-8");
  } catch {
    return null;
  }

  // Parse simple frontmatter (--- delimited)
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

  let name = "";
  let description = "";
  let triggerPhrases: string[] = [];
  let promptTemplate: string;

  if (frontmatterMatch) {
    const meta = frontmatterMatch[1];
    promptTemplate = frontmatterMatch[2].trim();

    // Simple key-value parsing from frontmatter
    for (const line of meta.split("\n")) {
      const [key, ...rest] = line.split(":");
      const value = rest.join(":").trim();
      if (key.trim() === "name") name = value;
      if (key.trim() === "description") description = value;
      if (key.trim() === "triggers") {
        triggerPhrases = value.split(",").map((s) => s.trim()).filter(Boolean);
      }
    }
  } else {
    promptTemplate = content.trim();
  }

  return {
    name,
    description,
    triggerPhrases,
    promptTemplate,
    sourcePath: path,
  };
}

/**
 * Load skills from all standard locations:
 * 1. .phase2s/skills/ in the current project
 * 2. ~/.phase2s/skills/ for global user skills
 */
export async function loadAllSkills(): Promise<Skill[]> {
  const skills: Skill[] = [];
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";

  const dirs = [
    join(process.cwd(), ".phase2s", "skills"),
    join(home, ".phase2s", "skills"),
  ];

  for (const dir of dirs) {
    const loaded = await loadSkillsFromDir(dir);
    skills.push(...loaded);
  }

  return skills;
}
