import type { Skill } from "./types.js";

/**
 * Substitute declared skill inputs into a prompt template.
 *
 * Only replaces {{name}} tokens that are declared in skill.inputs.
 * Unknown {{tokens}} pass through unchanged — this means existing templates
 * like /explain's {{target}} are safe even when no inputs: frontmatter exists.
 *
 * Precedence: deny overrides allow (consistent with ToolRegistry.allowed()).
 */
export function substituteInputs(
  template: string,
  values: Record<string, string>,
  inputs: Skill["inputs"],
): string {
  if (!inputs) return template;

  let result = template;
  for (const key of Object.keys(inputs)) {
    const value = values[key] ?? "";
    // Only replace tokens explicitly declared in inputs
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}

/**
 * Return the list of input keys that have unfilled {{placeholder}} tokens
 * in the given template. Only checks keys declared in skill.inputs.
 */
export function getUnfilledInputKeys(
  template: string,
  inputs: Skill["inputs"],
): string[] {
  if (!inputs) return [];
  return Object.keys(inputs).filter((key) => template.includes(`{{${key}}}`));
}

/**
 * Grammar for {{ASK:}} tokens:
 *
 *   {{ASK: <prompt text>}}
 *
 * Rules (v1):
 * - Token begins at "{{ASK:" (case-sensitive)
 * - Prompt text is everything after the colon+space up to the first "}}"
 * - No nesting: the first "}}" encountered closes the token
 * - No escape sequences in v1 — prompt text must not contain "}}"
 * - Leading/trailing whitespace in the prompt text is trimmed
 * - The same prompt text appearing multiple times is a duplicate; ask once, reuse answer
 */
const ASK_TOKEN_RE = /\{\{ASK:\s*([\s\S]*?)\}\}/g;

export interface AskToken {
  /** The full placeholder string, e.g. "{{ASK: What feature?}}" */
  placeholder: string;
  /** The prompt text shown to the user, e.g. "What feature?" */
  prompt: string;
}

/**
 * Extract all {{ASK:}} tokens from a template.
 * Returns unique tokens in left-to-right order (first occurrence wins for dedup).
 */
export function extractAskTokens(template: string): AskToken[] {
  const seen = new Set<string>();
  const tokens: AskToken[] = [];
  for (const match of template.matchAll(ASK_TOKEN_RE)) {
    const placeholder = match[0];
    const prompt = match[1].trim();
    if (!seen.has(prompt)) {
      seen.add(prompt);
      tokens.push({ placeholder, prompt });
    }
  }
  return tokens;
}

/**
 * Substitute answers for all {{ASK:}} tokens in a template.
 *
 * @param template - The prompt template (may contain {{ASK:...}} tokens)
 * @param answers  - Map from prompt text → user answer
 * @returns Template with all matching tokens replaced by their answers
 */
export function substituteAskValues(
  template: string,
  answers: Map<string, string>,
): string {
  return template.replace(ASK_TOKEN_RE, (_match, promptText: string) => {
    const key = promptText.trim();
    return answers.get(key) ?? "";
  });
}

/**
 * Strip all {{ASK:}} tokens from a template, replacing each with an empty string.
 * Used in non-interactive modes (one-shot, MCP, --full-auto).
 *
 * Returns { result, stripped } where stripped is true if any tokens were removed.
 */
export function stripAskTokens(template: string): {
  result: string;
  stripped: boolean;
} {
  let stripped = false;
  const result = template.replace(ASK_TOKEN_RE, () => {
    stripped = true;
    return "";
  });
  return { result, stripped };
}
