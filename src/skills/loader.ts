import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Skill } from "./types.js";

/**
 * Load skills from SKILL.md files in a directory.
 *
 * Follows a convention similar to gstack: each skill is a directory
 * containing a SKILL.md file with YAML-like frontmatter.
 *
 * Compatible with the SKILL.md standard used by:
 *   - phase2s (.phase2s/skills/)
 *   - Codex CLI (~/.codex/skills/)
 *   - gstack/Claude Code (~/.claude/skills/)
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

  // Parse YAML frontmatter (--- delimited, handles \r\n line endings)
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);

  let name = "";
  let description = "";
  let triggerPhrases: string[] = [];
  let promptTemplate: string;

  if (frontmatterMatch) {
    const rawMeta = frontmatterMatch[1];
    promptTemplate = frontmatterMatch[2].trim();

    // Parse frontmatter with the yaml library (handles multi-line, arrays, quoted strings)
    let meta: Record<string, unknown> = {};
    try {
      meta = (parseYaml(rawMeta) as Record<string, unknown>) ?? {};
    } catch {
      // Malformed frontmatter — treat as no frontmatter
    }

    if (typeof meta.name === "string") name = meta.name;
    if (typeof meta.description === "string") description = meta.description;

    // triggers can be a YAML array or a comma-separated string
    if (Array.isArray(meta.triggers)) {
      triggerPhrases = meta.triggers.filter((t): t is string => typeof t === "string");
    } else if (typeof meta.triggers === "string") {
      triggerPhrases = meta.triggers.split(",").map((s) => s.trim()).filter(Boolean);
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
 * Load skills from all standard locations (in priority order):
 * 1. .phase2s/skills/ — current project skills (highest priority)
 * 2. ~/.phase2s/skills/ — global user skills
 * 3. ~/.codex/skills/ — Codex CLI's native skill directory (cross-tool compatibility)
 *
 * Deduplication: first skill found with a given name wins (project > global > codex).
 */
export async function loadAllSkills(): Promise<Skill[]> {
  const skills: Skill[] = [];
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";

  const dirs = [
    join(process.cwd(), ".phase2s", "skills"),
    join(home, ".phase2s", "skills"),
    join(home, ".codex", "skills"),  // Codex CLI native skills — same SKILL.md format
  ];

  const seen = new Set<string>();

  for (const dir of dirs) {
    const loaded = await loadSkillsFromDir(dir);
    for (const skill of loaded) {
      // Deduplicate by name: project skills override global, global override codex defaults
      if (!seen.has(skill.name)) {
        seen.add(skill.name);
        skills.push(skill);
      }
    }
  }

  return skills;
}
