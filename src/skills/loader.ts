import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import type { Skill } from "./types.js";

/**
 * Resolve the path to the skills bundled inside the installed package.
 *
 * At runtime this file lives at:
 *   <pkg-root>/dist/src/skills/loader.js
 *
 * The bundled skills live at:
 *   <pkg-root>/.phase2s/skills/
 *
 * Three levels up from this file's directory gets us to <pkg-root>.
 */
function bundledSkillsDir(): string {
  const thisFile = fileURLToPath(import.meta.url);
  const pkgRoot = resolve(dirname(thisFile), "../../..");
  return join(pkgRoot, ".phase2s", "skills");
}

/**
 * Return the absolute path to the bundled spec templates directory shipped
 * inside the npm package at .phase2s/templates/.
 *
 * Three levels up from this file's directory gets us to <pkg-root>
 * (same calculation as bundledSkillsDir).
 */
export function bundledTemplatesDir(): string {
  const thisFile = fileURLToPath(import.meta.url);
  const pkgRoot = resolve(dirname(thisFile), "../../..");
  return join(pkgRoot, ".phase2s", "templates");
}

/**
 * Return the absolute path to the bundled ZSH shell plugin shipped inside the
 * npm package at .phase2s/shell/phase2s.plugin.zsh.
 *
 * Three levels up from this file's directory gets us to <pkg-root>
 * (same calculation as bundledTemplatesDir).
 *
 * At runtime:  dist/src/skills/loader.js  → 3 up → <pkg-root>
 * In vitest:   src/skills/loader.ts       → 3 up → PARENT of project root (wrong)
 * Tests must vi.mock this module to return the correct source path.
 */
export function bundledShellPluginPath(): string {
  const thisFile = fileURLToPath(import.meta.url);
  const pkgRoot = resolve(dirname(thisFile), "../../..");
  return join(pkgRoot, ".phase2s", "shell", "phase2s.plugin.zsh");
}

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
  let skill_model: string | undefined;
  let skill_retries: number | undefined;
  let skill_inputs: import("./types.js").Skill["inputs"] | undefined;

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

    if (typeof meta.model === "string" && meta.model.length > 0) {
      const VALID_MODEL_TIERS = ["fast", "smart"];
      // Allow "fast", "smart", and any literal model string (non-empty).
      // Warn if it looks like a misspelled tier (short word, not a known model ID).
      const isLiteralModel = meta.model.includes("-") || meta.model.includes("/") || meta.model.includes(".");
      const isKnownTier = VALID_MODEL_TIERS.includes(meta.model);
      if (!isKnownTier && !isLiteralModel && meta.model.length < 20) {
        console.warn(`[phase2s] Warning: skill at ${path}: model: '${meta.model}' looks like a misspelled tier. Valid tiers: fast, smart. Treating as literal model name.`);
      }
      skill_model = meta.model;
    }
    if (typeof meta.retries === "number" && meta.retries > 0) skill_retries = meta.retries;

    // Parse inputs: key — must be an object mapping name → { prompt: string, type?, enum? }
    if (
      meta.inputs !== null &&
      meta.inputs !== undefined &&
      typeof meta.inputs === "object" &&
      !Array.isArray(meta.inputs)
    ) {
      const rawInputs = meta.inputs as Record<string, unknown>;
      const parsed: import("./types.js").Skill["inputs"] = {};
      const VALID_INPUT_TYPES = ["string", "boolean", "enum", "number"] as const;
      type ValidInputType = (typeof VALID_INPUT_TYPES)[number];

      for (const [key, val] of Object.entries(rawInputs)) {
        if (
          val !== null &&
          typeof val === "object" &&
          !Array.isArray(val) &&
          typeof (val as Record<string, unknown>).prompt === "string"
        ) {
          const rawVal = val as Record<string, unknown>;
          const input: import("./types.js").SkillInput = {
            prompt: rawVal.prompt as string,
          };

          // Parse type field
          if (rawVal.type !== undefined) {
            if (VALID_INPUT_TYPES.includes(rawVal.type as ValidInputType)) {
              input.type = rawVal.type as ValidInputType;
            } else {
              console.warn(`[phase2s] Warning: skill at ${path}: input '${key}' has unrecognized type: '${rawVal.type}'. Valid types: string, boolean, enum, number. Falling back to 'string'.`);
              input.type = "string";
            }
          }

          // Parse enum field (only meaningful when type === "enum")
          if (rawVal.enum !== undefined) {
            if (Array.isArray(rawVal.enum)) {
              input.enum = rawVal.enum.filter((e): e is string => typeof e === "string");
            } else if (typeof rawVal.enum === "string") {
              // YAML parsers coerce single-item arrays to strings — normalize gracefully
              console.warn(`[phase2s] Warning: skill at ${path}: input '${key}' enum: is a string, not an array. Coercing to single-element array ['${rawVal.enum}'].`);
              input.enum = [rawVal.enum];
            }
          }

          // Validate enum completeness: type=enum with empty/absent enum array falls back to string
          if (input.type === "enum" && (!input.enum || input.enum.length === 0)) {
            console.warn(`[phase2s] Warning: skill at ${path}: input '${key}' has type: 'enum' but no valid enum values. Falling back to type: 'string'.`);
            input.type = "string";
            delete input.enum;
          }

          parsed[key] = input;
        }
      }
      if (Object.keys(parsed).length > 0) skill_inputs = parsed;
    }
  } else {
    promptTemplate = content.trim();
  }

  const skill: import("./types.js").Skill = {
    name,
    description,
    triggerPhrases,
    promptTemplate,
    sourcePath: path,
  };
  if (skill_model !== undefined) skill.model = skill_model;
  if (skill_retries !== undefined) skill.retries = skill_retries;
  if (skill_inputs !== undefined) skill.inputs = skill_inputs;
  return skill;
}

/**
 * Load skills from all standard locations (in priority order):
 * 1. .phase2s/skills/ — current project skills (highest priority)
 * 2. ~/.phase2s/skills/ — global user skills
 * 3. ~/.codex/skills/ — Codex CLI's native skill directory (cross-tool compatibility)
 * 4. <pkg-root>/.phase2s/skills/ — skills bundled inside the installed package (lowest priority)
 *
 * Deduplication: first skill found with a given name wins.
 * Project skills override global, global override codex, all override bundled defaults.
 */
export async function loadAllSkills(): Promise<Skill[]> {
  const skills: Skill[] = [];
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";

  const dirs = [
    join(process.cwd(), ".phase2s", "skills"),
    join(home, ".phase2s", "skills"),
    join(home, ".codex", "skills"),  // Codex CLI native skills — same SKILL.md format
    bundledSkillsDir(),               // skills shipped inside the npm package
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
