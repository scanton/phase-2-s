/**
 * Agent loader — loads named agent definitions from .md files with YAML frontmatter.
 *
 * Agent search order (later entries override earlier):
 *   1. Bundled built-in agents shipped with the Phase2S package (.phase2s/agents/)
 *   2. Project-local overrides from <cwd>/.phase2s/agents/
 *
 * Override-restrict policy: project overrides of built-in agents (same id) may only
 * NARROW the tool list, not expand it. A project cannot give Apollo write access.
 * Custom agents (new ids not in built-ins) are unrestricted.
 *
 * The returned Map is keyed by both agent id and all aliases, so callers can look
 * up ":ask" or "apollo" and get the same AgentDef.
 */

import { readFile, readdir } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontmatter } from "../utils/frontmatter.js";
import { createDefaultRegistry, ToolRegistry, type RegistryOptions } from "../tools/index.js";
import { createPlansWriteTool } from "../tools/plans-write.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentDef {
  /** Canonical agent id, e.g. "apollo" */
  id: string;
  /** Human-readable title shown in :agents listing */
  title: string;
  /** Model tier: "fast" | "smart" | literal model id */
  model: string;
  /**
   * Explicit tool list. undefined = full default registry (Ares pattern).
   * Built-in tool names: glob, grep, file_read, browser, shell, file_write, plans_write
   */
  tools: string[] | undefined;
  /** Colon-prefixed aliases, e.g. [":ask"] */
  aliases: string[];
  /** System prompt body (markdown text after frontmatter) */
  systemPrompt: string;
  /** Whether this agent came from the built-in bundle (not a project override) */
  isBuiltIn: boolean;
}

// ---------------------------------------------------------------------------
// Built-in agents directory
// ---------------------------------------------------------------------------

/**
 * Resolve the path to the bundled agents directory shipped inside the package.
 *
 * At runtime this file lives at:
 *   <pkg-root>/dist/src/core/agent-loader.js
 *
 * The bundled agents live at:
 *   <pkg-root>/.phase2s/agents/
 *
 * Three levels up from this file's directory gets us to <pkg-root>.
 */
function bundledAgentsDir(): string {
  const thisFile = fileURLToPath(import.meta.url);
  const pkgRoot = resolve(dirname(thisFile), "../../..");
  return join(pkgRoot, ".phase2s", "agents");
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse a single agent .md file. Returns null if the file is missing or malformed
 * in a way that makes the agent unusable (no id).
 *
 * Errors are logged as warnings rather than thrown so one bad file doesn't break
 * startup (per-file error isolation).
 */
async function parseAgentFile(filePath: string, isBuiltIn: boolean): Promise<AgentDef | null> {
  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch {
    return null;
  }

  const { meta, body } = parseFrontmatter(content);

  const id = typeof meta.id === "string" ? meta.id.trim() : "";
  if (!id) {
    console.warn(`Warning: agent file ${filePath} has no 'id' field — skipping`);
    return null;
  }

  const title = typeof meta.title === "string" ? meta.title.trim() : id;
  const model = typeof meta.model === "string" && meta.model.trim() ? meta.model.trim() : "smart";

  // tools: may be a YAML list of strings, or absent (= full registry)
  let tools: string[] | undefined;
  if (Array.isArray(meta.tools)) {
    tools = meta.tools.filter((t): t is string => typeof t === "string").map((t) => t.trim());
  } else if (meta.tools !== undefined && meta.tools !== null) {
    // Unknown type for tools field — warn and treat as full registry
    console.warn(`Warning: agent '${id}' has invalid 'tools' field — using full registry`);
  }

  // aliases: YAML list of strings
  let aliases: string[] = [];
  if (Array.isArray(meta.aliases)) {
    aliases = meta.aliases
      .filter((a): a is string => typeof a === "string")
      .map((a) => a.trim())
      .filter(Boolean);
  }

  return { id, title, model, tools, aliases, systemPrompt: body, isBuiltIn };
}

/**
 * Load all agent .md files from a directory.
 * Per-file errors are caught and logged — they don't abort the load.
 */
async function loadAgentsFromDir(dir: string, isBuiltIn: boolean): Promise<AgentDef[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const agents: AgentDef[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".md") || entry === "README.md") continue;
    const agentPath = join(dir, entry);
    try {
      const def = await parseAgentFile(agentPath, isBuiltIn);
      if (def) agents.push(def);
    } catch (err) {
      console.warn(`Warning: failed to load agent from ${agentPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return agents;
}

// ---------------------------------------------------------------------------
// Override-restrict validation
// ---------------------------------------------------------------------------

/**
 * Apply override-restrict policy: a project override of a built-in agent may
 * only narrow the tool list, never expand it.
 *
 * If the override has no tools field (undefined), it inherits the built-in list.
 * If the override adds a tool not in the built-in list, that tool is filtered
 * out with a warning.
 */
function applyOverrideRestrict(builtIn: AgentDef, override: AgentDef): AgentDef {
  if (override.tools === undefined) {
    // No tools field in override — inherit built-in's tool list
    return { ...override, tools: builtIn.tools, isBuiltIn: false };
  }

  if (builtIn.tools === undefined) {
    // Built-in has full registry (no restriction). Override can only restrict.
    // Any tool list is valid since the built-in allows everything.
    return { ...override, isBuiltIn: false };
  }

  // Both have explicit tool lists. Validate: override must be a subset of built-in.
  const invalid = override.tools.filter((t) => !builtIn.tools!.includes(t));
  if (invalid.length > 0) {
    console.warn(
      `Warning: project override for agent '${override.id}' attempts to add tool(s) not in built-in: ` +
        `${invalid.join(", ")}. These will be ignored (override-restrict policy).`,
    );
  }
  const restricted = override.tools.filter((t) => builtIn.tools!.includes(t));
  return { ...override, tools: restricted, isBuiltIn: false };
}

// ---------------------------------------------------------------------------
// Registry construction
// ---------------------------------------------------------------------------

/**
 * Build a ToolRegistry for the given AgentDef.
 *
 * - No tools field (undefined) → full default registry (Ares)
 * - Explicit tools list → default registry filtered to that list
 * - "plans_write" in the list → inject the sandboxed plans_write tool
 */
export function buildRegistryForAgent(def: AgentDef, opts: RegistryOptions = {}): ToolRegistry {
  const base = createDefaultRegistry(opts);

  if (def.tools === undefined) {
    // Full registry — Ares pattern
    return base;
  }

  // Empty tools list = no tools allowed (explicit deny-all).
  // This prevents a project override with tools: [] from accidentally receiving the
  // full registry via ToolRegistry.allowed([]) (which treats an empty allow-list as
  // "no restriction" for configuration use cases). We treat [] as a strict deny-all.
  if (def.tools.length === 0) {
    return new ToolRegistry();
  }

  // Inject plans_write if requested (it's not in the default registry)
  if (def.tools.includes("plans_write")) {
    const cwd = opts.cwd ?? process.cwd();
    base.register(createPlansWriteTool(cwd));
  }

  // Filter to the declared tool list (tool names other than plans_write)
  const toolList = def.tools;
  return base.allowed(toolList);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load all agents: bundled built-ins + project-local overrides.
 *
 * Returns a Map keyed by both agent id and all aliases.
 * Example: get("apollo") and get(":ask") both return the Apollo AgentDef.
 *
 * If a project-local agent has the same id as a built-in, the override-restrict
 * policy is applied. Custom agents (new ids) are loaded unrestricted.
 */
export async function loadAgents(cwd: string): Promise<Map<string, AgentDef>> {
  // Load built-ins
  const builtInDefs = await loadAgentsFromDir(bundledAgentsDir(), true);

  // Load project overrides
  const projectDir = join(cwd, ".phase2s", "agents");
  const projectDefs = await loadAgentsFromDir(projectDir, false);

  // Build lookup map of built-ins by id
  const builtInById = new Map<string, AgentDef>();
  for (const def of builtInDefs) {
    builtInById.set(def.id, def);
  }

  // Merge: project overrides win, with override-restrict policy for built-ins
  const finalById = new Map<string, AgentDef>(builtInById);
  for (const projectDef of projectDefs) {
    const existing = builtInById.get(projectDef.id);
    if (existing) {
      // Override of a built-in — apply restrict policy
      finalById.set(projectDef.id, applyOverrideRestrict(existing, projectDef));
    } else {
      // New custom agent — no restriction
      finalById.set(projectDef.id, projectDef);
    }
  }

  // Build the final Map with all ids + aliases as keys
  const result = new Map<string, AgentDef>();
  for (const def of finalById.values()) {
    result.set(def.id, def);
    for (const alias of def.aliases) {
      result.set(alias, def);
    }
  }

  return result;
}

/**
 * Format the agents list for :agents display.
 */
export function formatAgentsList(agents: Map<string, AgentDef>): string {
  // Deduplicate by id (aliases point to same def)
  const seen = new Set<string>();
  const unique: AgentDef[] = [];
  for (const def of agents.values()) {
    if (!seen.has(def.id)) {
      seen.add(def.id);
      unique.push(def);
    }
  }

  // Sort: built-ins first (ares, apollo, athena), then custom
  const builtInOrder = ["ares", "apollo", "athena"];
  unique.sort((a, b) => {
    const ai = builtInOrder.indexOf(a.id);
    const bi = builtInOrder.indexOf(b.id);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.id.localeCompare(b.id);
  });

  const lines: string[] = ["Available agents:"];
  for (const def of unique) {
    const allNames = [def.id, ...def.aliases].join(" / ");
    const toolCount = def.tools === undefined ? "all tools" : `${def.tools.length} tools`;
    const marker = def.isBuiltIn ? "" : " (custom)";
    lines.push(`  ${allNames.padEnd(30)} ${def.title} [${def.model}, ${toolCount}]${marker}`);
  }
  return lines.join("\n");
}
