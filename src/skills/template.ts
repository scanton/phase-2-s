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
