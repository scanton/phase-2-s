/**
 * Pure colon-command dispatcher extracted from interactiveMode().
 *
 * handleColonCommand() classifies a REPL input string and returns a ColonAction
 * discriminated union. No console.log, no side effects — the caller applies those.
 * This makes command routing fully testable without readline scaffolding.
 *
 * Commands that require nextLine() (interactive readline reads) stay in the
 * REPL loop and are not handled here: :clone, :commit.
 */

import type { AgentDef } from "../core/agent-loader.js";

// ---------------------------------------------------------------------------
// ColonAction discriminated union
// ---------------------------------------------------------------------------

export type ColonAction =
  /** Input is not a colon command — fall through to skill/LLM handling. */
  | { type: "not_handled" }
  /** :re with no argument — REPL loop prints current reasoning state. */
  | { type: "show_reasoning" }
  /** :re high / :re low / :re default */
  | { type: "set_reasoning"; tier: "high" | "low" | undefined }
  /** :agents — list available named agents */
  | { type: "list_agents" }
  /** Successful agent switch (bare id, colon alias, or :agent <id>) */
  | { type: "switch_agent"; agentId: string; agentDef: AgentDef }
  /** :agent <id> with an unrecognized id */
  | { type: "unknown_agent"; requestedId: string }
  /** :goal <path> — run a goal spec from within the REPL */
  | { type: "run_goal"; goalPath: string; goalArgs: string[] }
  /** :dump [html] — export conversation as markdown or HTML */
  | { type: "dump_conversation"; format: "markdown" | "html" }
  /** :help — show command reference */
  | { type: "show_help" }
  /** :xyz — unrecognized colon command (not :clone or :commit) */
  | { type: "unknown_command"; command: string }
  /** :re <invalid tier> */
  | { type: "error"; message: string };

// ---------------------------------------------------------------------------
// COMMAND_REGISTRY — static list of documented REPL commands for :help
// ---------------------------------------------------------------------------

export const COMMAND_REGISTRY: Array<{ command: string; description: string }> = [
  { command: ":re [high|low|default]", description: "Set or show reasoning effort tier" },
  { command: ":agents",               description: "List available named agents" },
  { command: ":agent <id>",           description: "Switch to a named agent (or use bare id)" },
  { command: ":goal <path>",          description: "Run a goal spec file without leaving the REPL" },
  { command: ":clone [branch]",       description: "Branch the current session into a new one" },
  { command: ":commit [message]",     description: "AI-generated commit message and commit" },
  { command: ":compact",              description: "Compact the current session context" },
  { command: ":dump [html]",          description: "Export conversation as markdown (or HTML)" },
  { command: ":help",                 description: "Show this command reference" },
];

// ---------------------------------------------------------------------------
// Context passed in from the REPL loop
// ---------------------------------------------------------------------------

export interface ColonCommandCtx {
  agentDefs: Map<string, AgentDef>;
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/**
 * Classify a trimmed REPL input string into a ColonAction.
 *
 * Routing table (in order of evaluation):
 *   bare agent id (e.g. "ares")      → switch_agent  (no colon; checked first)
 *   other plain text                 → not_handled  (pass to skill/LLM)
 *   :clone / :commit prefix          → not_handled  (owned by REPL loop — need nextLine())
 *   :re [tier]                       → show_reasoning | set_reasoning | error
 *   :agents                          → list_agents
 *   colon agent id/alias (e.g. ":ares", ":build")  → switch_agent
 *   :agent <id> with unknown id      → unknown_agent
 *   other :xyz                       → unknown_command
 */
export function handleColonCommand(trimmed: string, ctx: ColonCommandCtx): ColonAction {
  const { agentDefs } = ctx;

  // Not a colon command — pass through
  if (!trimmed.startsWith(":")) {
    // Bare agent ids (e.g. "ares", "apollo") ARE documented (docs/agents.md).
    // Check the agentDefs map before passing to the LLM.
    if (agentDefs.has(trimmed)) {
      const def = agentDefs.get(trimmed)!;
      return { type: "switch_agent", agentId: def.id, agentDef: def };
    }
    return { type: "not_handled" };
  }

  // :clone and :commit require nextLine() — owned by the REPL loop
  if (trimmed.startsWith(":clone") || trimmed.startsWith(":commit")) {
    return { type: "not_handled" };
  }

  // :goal <path> [args] — run a spec file from within the REPL
  if (trimmed === ":goal" || trimmed.startsWith(":goal ")) {
    const rest = trimmed.slice(":goal".length).trim();
    const GOAL_USAGE = "Usage: :goal <spec-file> [args]\nExample: :goal specs/auth.md";
    if (!rest) {
      return { type: "error", message: GOAL_USAGE };
    }
    const { goalPath, goalArgs } = parseGoalArgs(rest);
    if (!goalPath) {
      return { type: "error", message: GOAL_USAGE };
    }
    return { type: "run_goal", goalPath, goalArgs };
  }

  // :re [high|low|default]
  if (trimmed === ":re" || trimmed.startsWith(":re ")) {
    const arg = trimmed.slice(":re".length).trim().toLowerCase();
    if (arg === "") return { type: "show_reasoning" };
    if (arg === "high") return { type: "set_reasoning", tier: "high" };
    if (arg === "low") return { type: "set_reasoning", tier: "low" };
    if (arg === "default") return { type: "set_reasoning", tier: undefined };
    return { type: "error", message: `Unknown tier: ${arg}. Valid options: high | low | default` };
  }

  // :agents
  if (trimmed === ":agents") return { type: "list_agents" };

  // :dump [html|markdown]
  if (trimmed === ":dump" || trimmed.startsWith(":dump ")) {
    const arg = trimmed.slice(":dump".length).trim().toLowerCase();
    if (arg === "html") return { type: "dump_conversation", format: "html" };
    return { type: "dump_conversation", format: "markdown" };
  }

  // :help
  if (trimmed === ":help") return { type: "show_help" };

  // Agent switching — handles:
  //   bare ids:          "ares" (caught above, but :ares handled here via strip)
  //   colon-prefixed:    ":ares", ":apollo", ":athena"
  //   aliases:           ":build", ":ask", ":plan"
  //   explicit command:  ":agent <id>"
  {
    const strippedKey =
      !trimmed.startsWith(":agent ") ? trimmed.slice(1) : "";
    const agentSwitchKey = agentDefs.has(trimmed)
      ? trimmed
      : strippedKey && agentDefs.has(strippedKey)
        ? strippedKey
        : undefined;
    const agentFromCmd = agentSwitchKey
      ? agentDefs.get(agentSwitchKey)!
      : trimmed.startsWith(":agent ")
        ? agentDefs.get(trimmed.slice(":agent ".length).trim())
        : undefined;

    if (agentFromCmd) {
      return { type: "switch_agent", agentId: agentFromCmd.id, agentDef: agentFromCmd };
    }

    if (trimmed.startsWith(":agent ")) {
      const requestedId = trimmed.slice(":agent ".length).trim();
      return { type: "unknown_agent", requestedId };
    }
  }

  // Unrecognized colon command
  return { type: "unknown_command", command: trimmed };
}

// ---------------------------------------------------------------------------
// parseGoalArgs
// ---------------------------------------------------------------------------

/**
 * Tokenize a :goal argument string with quote-aware parsing.
 * Handles paths with spaces when quoted: :goal "my spec/file.md"
 */
function parseGoalArgs(input: string): { goalPath: string; goalArgs: string[] } {
  const tokens: string[] = [];
  let i = 0;
  while (i < input.length) {
    if (input[i] === " ") { i++; continue; }
    if (input[i] === '"' || input[i] === "'") {
      const quote = input[i++];
      let tok = "";
      while (i < input.length && input[i] !== quote) tok += input[i++];
      if (i < input.length) i++; // skip closing quote
      tokens.push(tok);
    } else {
      let tok = "";
      while (i < input.length && input[i] !== " ") tok += input[i++];
      tokens.push(tok);
    }
  }
  return { goalPath: tokens[0] ?? "", goalArgs: tokens.slice(1) };
}
