/**
 * Pure model resolution helpers extracted from interactiveMode().
 *
 * Both functions are stateless and have no side effects, which makes them
 * trivially testable without readline scaffolding.
 */

/**
 * Resolve the model override for a REPL turn based on the active :re tier.
 * Returns undefined (fall through to config.model) when no override is active
 * or when the tier-specific model is not configured.
 */
export function resolveReasoningModel(
  override: "high" | "low" | undefined,
  config: { smart_model?: string; fast_model?: string },
): string | undefined {
  if (override === "high") return config.smart_model;
  if (override === "low") return config.fast_model;
  return undefined;
}

/**
 * Resolve an AgentDef model tier ("fast" | "smart" | literal) to an actual model ID.
 * Returns undefined if the tier maps to an unconfigured model (fall through to config.model).
 */
export function resolveAgentModel(
  agentModel: string,
  config: { smart_model?: string; fast_model?: string; model?: string },
): string | undefined {
  if (agentModel === "smart") return config.smart_model;
  if (agentModel === "fast") return config.fast_model;
  // Literal model string (e.g. "gpt-4o") — always valid
  return agentModel;
}
