/**
 * phase2s template — spec template library.
 *
 * Commands:
 *   phase2s template list              — list all bundled templates
 *   phase2s template use <name>        — run wizard, produce a 5-pillar spec
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { bundledTemplatesDir } from "../skills/loader.js";
import { createRl, ask, PromptInterrupt } from "./prompt-util.js";
import { runLint } from "./lint.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TemplateMeta {
  title: string;
  description: string;
  placeholders: string[];
}

// ---------------------------------------------------------------------------
// Frontmatter parser (hand-rolled — no runtime deps)
// ---------------------------------------------------------------------------

/**
 * Parse YAML frontmatter from a template file.
 *
 * Expected format:
 * ```
 * ---
 * title: My Template
 * description: One-line description
 * placeholders:
 *   - token_one
 *   - token_two
 * ---
 * <spec body>
 * ```
 *
 * Only supports the three expected keys. Unknown keys are ignored.
 */
export function parseFrontmatter(content: string): { meta: TemplateMeta; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n([\s\S]*))?$/);
  if (!match) {
    throw new Error("Template missing YAML frontmatter (expected --- ... --- block at top)");
  }
  const frontmatter = match[1];
  const body = match[2] ?? "";

  let title = "";
  let description = "";
  const placeholders: string[] = [];
  let inPlaceholders = false;

  for (const rawLine of frontmatter.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    const titleMatch = line.match(/^title:\s*(.+)$/);
    const descMatch = line.match(/^description:\s*(.+)$/);
    const placeholdersKey = line.match(/^placeholders:\s*$/);
    const listItem = line.match(/^\s+-\s+(.+)$/);

    if (titleMatch) { title = titleMatch[1].trim(); inPlaceholders = false; }
    else if (descMatch) { description = descMatch[1].trim(); inPlaceholders = false; }
    else if (placeholdersKey) { inPlaceholders = true; }
    else if (listItem && inPlaceholders) { placeholders.push(listItem[1].trim()); }
    else if (line.trim() && !line.startsWith(" ") && !line.startsWith("\t")) { inPlaceholders = false; }
  }

  if (!title) throw new Error("Template frontmatter missing required field: title");
  if (!description) throw new Error("Template frontmatter missing required field: description");

  return { meta: { title, description, placeholders }, body };
}

// ---------------------------------------------------------------------------
// Template discovery
// ---------------------------------------------------------------------------

interface TemplateEntry {
  name: string;
  meta: TemplateMeta;
  filePath: string;
}

function loadTemplates(): TemplateEntry[] {
  const dir = bundledTemplatesDir();
  if (!existsSync(dir)) return [];

  const entries: TemplateEntry[] = [];
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith(".md")) continue;
    const name = file.replace(/\.md$/, "");
    const filePath = join(dir, file);
    try {
      const content = readFileSync(filePath, "utf8");
      const { meta } = parseFrontmatter(content);
      entries.push({ name, meta, filePath });
    } catch (err) {
      console.warn(`[phase2s] Skipping malformed template: ${filePath}: ${(err as Error).message}`);
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/**
 * `phase2s template list` — print all bundled templates.
 */
export function runTemplateList(): void {
  const templates = loadTemplates();

  if (templates.length === 0) {
    console.log(chalk.yellow("\n  No templates found. Reinstall phase2s to restore bundled templates.\n"));
    process.exit(1);
  }

  console.log(chalk.bold("\nAvailable spec templates:\n"));
  for (const { name, meta } of templates) {
    console.log(`  ${chalk.cyan(name.padEnd(12))}  ${meta.description}`);
  }
  console.log();
  console.log(`  Run ${chalk.bold("phase2s template use <name>")} to generate a spec.\n`);
}

/**
 * `phase2s template use <name>` — run the wizard and produce a spec file.
 */
export async function runTemplateUse(name: string, cwd: string): Promise<void> {
  const templates = loadTemplates();
  const validNames = templates.map((t) => t.name);
  const entry = templates.find((t) => t.name === name);

  if (!entry) {
    console.error(chalk.red(`\n  Unknown template: "${name}"\n`));
    console.log("  Available templates:");
    for (const n of validNames) {
      console.log(`    ${chalk.cyan(n)}`);
    }
    console.log();
    process.exit(1);
    return;
  }

  const content = readFileSync(entry.filePath, "utf8");
  const { meta, body } = parseFrontmatter(content);

  console.log(chalk.bold(`\n  Template: ${meta.title}`));
  console.log(`  ${meta.description}\n`);

  const rl = createRl();
  const values: Record<string, string> = {};

  try {
    for (const placeholder of meta.placeholders) {
      let value = "";
      while (!value) {
        value = await ask(rl, `  ${placeholder}: `);
        if (!value) {
          console.log(chalk.yellow("  (required — please enter a value)"));
        }
      }
      values[placeholder] = value;
    }
  } catch (err: unknown) {
    if (err instanceof PromptInterrupt) {
      console.log(chalk.dim("\nTemplate wizard cancelled."));
      return;
    }
    throw err;
  } finally {
    rl.close();
  }

  // Substitute {{token}} placeholders in body only (frontmatter is never written).
  // Single-pass regex replacement prevents cascade injection: if a user enters a value
  // that itself contains "{{token}}" syntax, it is not re-processed in subsequent iterations.
  const output = body.replace(/\{\{([^}]+)\}\}/g, (_match, key) => values[key as string] ?? `{{${key as string}}}`);

  // Warn about any tokens that weren't in the declared placeholders list.
  // These could be typos in the template or extra {{...}} in the spec body that
  // were never filled in — the user should know before running phase2s goal.
  const unresolvedTokens = [...output.matchAll(/\{\{([^}]+)\}\}/g)].map((m) => m[0]);
  if (unresolvedTokens.length > 0) {
    const unique = [...new Set(unresolvedTokens)];
    for (const token of unique) {
      console.warn(chalk.yellow(`  [phase2s] Warning: unresolved placeholder: ${token} — edit the spec before running phase2s goal.`));
    }
  }

  // Determine output path: .phase2s/specs/<name>-<timestamp>.md
  const specsDir = join(cwd, ".phase2s", "specs");
  try {
    mkdirSync(specsDir, { recursive: true });
  } catch (err) {
    console.error(chalk.red(`\n  Cannot create specs directory at ${specsDir}: ${(err as NodeJS.ErrnoException).message}\n  Check directory permissions.\n`));
    process.exit(1);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "-").slice(0, 19);
  let outPath = join(specsDir, `${name}-${timestamp}.md`);

  // Handle existing file — loop to find a free path (multiple rapid runs in same second)
  let counter = 1;
  while (existsSync(outPath)) {
    outPath = join(specsDir, `${name}-${timestamp}-${counter++}.md`);
  }

  try {
    writeFileSync(outPath, output, "utf8");
  } catch (err) {
    console.error(chalk.red(`\n  Cannot write spec to ${outPath}: ${(err as NodeJS.ErrnoException).message}\n  Check directory permissions.\n`));
    process.exit(1);
  }
  console.log(chalk.green(`\n  Spec written to: ${outPath}\n`));

  // Lint the generated spec
  console.log("  Running phase2s lint...\n");
  const ok = await runLint(outPath);
  if (!ok) {
    console.log(chalk.yellow("  Lint warnings above — edit the spec before running phase2s goal.\n"));
  } else {
    console.log(chalk.green("  Spec looks good. Run:\n"));
    // Quote the path so spaces don't break the copy-pasted command
    console.log(`    ${chalk.bold(`phase2s goal "${outPath}"`)}\n`);
  }
}
