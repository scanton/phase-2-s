import { parse as parseYaml } from "yaml";

/**
 * Parse YAML frontmatter from a markdown string.
 *
 * Frontmatter is a --- delimited YAML block at the start of the file.
 * Handles both LF and CRLF line endings.
 *
 * Returns `meta` (parsed YAML object) and `body` (remaining markdown text).
 * If no frontmatter block is found, returns `meta: {}` and `body: full content`.
 * If the YAML is malformed, returns `meta: {}` and `body: full content` (silent — let the caller decide).
 *
 * Shared by:
 *   - src/skills/loader.ts (skill definitions)
 *   - src/core/agent-loader.ts (agent definitions)
 */
export function parseFrontmatter(content: string): {
  meta: Record<string, unknown>;
  body: string;
} {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { meta: {}, body: content };
  }

  let meta: Record<string, unknown> = {};
  try {
    meta = (parseYaml(match[1]) as Record<string, unknown>) ?? {};
  } catch {
    // Malformed YAML — return empty meta, full content as body
    return { meta: {}, body: content };
  }

  return { meta, body: match[2].trim() };
}
