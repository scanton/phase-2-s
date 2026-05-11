/**
 * MCP tool descriptors and conversion utilities.
 *
 * Pure functions and constant declarations — zero side effects.
 * Extracted from server.ts (Sprint 52 decomposition).
 */

import type { Skill } from "../skills/types.js";

// ---------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------

export const MCP_SERVER_VERSION = "0.19.0";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
  /** Original skill name before the hyphen→underscore MCP naming transformation.
   * Stored so toolNameToSkillName() round-trip is not needed for lookup —
   * avoids the bug where a skill named `my_skill` would reverse-map to `my-skill`.
   * Prefixed with `_` to signal it is an internal routing property, not an LLM input. */
  _skillName?: string;
}

/**
 * A JSON-RPC notification — like a response but with no `id`.
 * Used for server-to-client push events (e.g. tools list changed).
 */
export interface MCPNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

// ---------------------------------------------------------------------------
// Tool generation
// ---------------------------------------------------------------------------

/**
 * Convert a Phase2S Skill into an MCP tool descriptor.
 *
 * Naming convention: `phase2s__<skill-name-with-underscores>`
 * e.g. "adversarial" → "phase2s__adversarial"
 *      "consensus-plan" → "phase2s__consensus_plan"
 */
export function skillToTool(skill: Skill): MCPTool {
  const properties: Record<string, unknown> = {
    prompt: {
      type: "string",
      description: `Task or content for the ${skill.name} skill. Paste the text you want analyzed or acted on.`,
    },
  };

  // Add declared inputs as named optional parameters with typed JSON Schema.
  // Claude Code will fill these in before calling the tool.
  if (skill.inputs) {
    for (const [key, input] of Object.entries(skill.inputs)) {
      switch (input.type) {
        case "boolean":
          properties[key] = { type: "boolean", description: input.prompt };
          break;
        case "number":
          properties[key] = { type: "number", description: input.prompt };
          break;
        case "enum":
          properties[key] = { type: "string", enum: input.enum, description: input.prompt };
          break;
        default:
          properties[key] = { type: "string", description: input.prompt };
      }
    }
  }

  return {
    name: `phase2s__${skill.name.replace(/-/g, "_")}`,
    description: skill.description || `Run the ${skill.name} skill`,
    inputSchema: {
      type: "object",
      properties,
      required: ["prompt"],
    },
    _skillName: skill.name,
  };
}

/**
 * Reverse the tool naming convention back to a skill name.
 * "phase2s__consensus_plan" → "consensus-plan"
 */
export function toolNameToSkillName(toolName: string): string {
  return toolName.replace(/^phase2s__/, "").replace(/_/g, "-");
}

// ---------------------------------------------------------------------------
// State tool descriptors
// ---------------------------------------------------------------------------

/**
 * The three durable state tools exposed alongside skill tools.
 *
 * Keys accept arbitrary strings (alphanumeric + hyphens + underscores).
 * Values are JSON-serializable objects. State is stored at
 * .phase2s/state/<key>.json relative to process.cwd() at server startup.
 */
export const STATE_TOOLS: MCPTool[] = [
  {
    name: "phase2s__state_write",
    description:
      "Write a JSON-serializable value to Phase2S durable state. " +
      "Creates .phase2s/state/<key>.json. Persists across turns and process restarts.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "State key (alphanumeric, hyphens, underscores)." },
        value: { description: "JSON-serializable value to store." },
      },
      required: ["key", "value"],
    },
  },
  {
    name: "phase2s__state_read",
    description:
      "Read a value from Phase2S durable state. " +
      "Returns the stored JSON value, or null if the key does not exist.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "State key to read." },
      },
      required: ["key"],
    },
  },
  {
    name: "phase2s__state_clear",
    description:
      "Delete a value from Phase2S durable state. No-op if the key does not exist.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "State key to delete." },
      },
      required: ["key"],
    },
  },
];

// ---------------------------------------------------------------------------
// Goal tool descriptor
// ---------------------------------------------------------------------------

/**
 * MCP tool descriptor for the dark factory goal executor.
 *
 * LONG-RUNNING: dark factory runs can take 20+ minutes. The MCP 2024-11-05
 * spec has no timeout requirement at the transport level, so synchronous
 * execution is safe. Claude Code should not expect a fast response.
 */
export const GOAL_TOOL: MCPTool = {
  name: "phase2s__goal",
  description:
    "Execute a spec file through the dark factory: optional adversarial pre-check, " +
    "implement each sub-task via satori, evaluate, retry until done. " +
    "LONG-RUNNING: may take 20+ minutes. Returns run summary + ABSOLUTE path to " +
    "structured JSONL run log. Read the log with file_read for per-sub-task details.",
  inputSchema: {
    type: "object",
    properties: {
      specFile: {
        type: "string",
        description: "Path to spec file (relative to project root or absolute).",
      },
      maxAttempts: {
        type: "number",
        description: "Max retry loops (default: 3).",
      },
      resume: {
        type: "boolean",
        description: "Resume from last completed sub-task.",
      },
      reviewBeforeRun: {
        type: "boolean",
        description: "Run adversarial review on spec before executing (recommended for new specs).",
      },
      notify: {
        type: "boolean",
        description: "Send a notification when the run completes (macOS + PHASE2S_SLACK_WEBHOOK if set).",
      },
    },
    required: ["specFile"],
  },
};

// ---------------------------------------------------------------------------
// Task tool descriptor (Sprint 84)
// ---------------------------------------------------------------------------

/**
 * Shared inputSchema for TASK_TOOL and TASK_COMPAT_TOOL.
 * Single source of truth — both tools expose identical parameters.
 */
const TASK_INPUT_SCHEMA: MCPTool["inputSchema"] = {
  type: "object",
  properties: {
    task: {
      type: "string",
      description: "The task to execute (e.g. 'fix the null pointer in auth.ts').",
    },
    verify_command: {
      type: "string",
      description: "Shell command to run after file writes to verify changes (e.g. 'npm test'). Overrides config.verifyCommand.",
    },
  },
  required: ["task"],
};

/**
 * MCP tool descriptor for the autonomous task executor.
 *
 * Activates task mode: injects the task-mode system prompt preamble, enables
 * doom-loop detection (same tool + same args 3x → exit), and auto-verify
 * injection (file_write success → run verifyCommand → inject result as user msg).
 */
export const TASK_TOOL: MCPTool = {
  name: "phase2s__go",
  description:
    "Execute a multi-step autonomous task with aggressive tool chaining, " +
    "auto-verify after file writes, and doom-loop prevention. " +
    "Use for tasks like 'fix the null pointer in auth.ts' or 'add tests for the parser module'. " +
    "The agent will plan, execute, verify, and report — no hand-holding required.",
  inputSchema: TASK_INPUT_SCHEMA,
};

/**
 * Backward-compatibility alias: `phase2s__task` → identical to `phase2s__go`.
 * MCP clients that cached the old tool name continue to work without error.
 * @deprecated Use phase2s__go instead.
 */
export const TASK_COMPAT_TOOL: MCPTool = {
  name: "phase2s__task",
  description:
    "[Deprecated — use phase2s__go] Alias kept for backward compatibility. " +
    "Execute a multi-step autonomous task with aggressive tool chaining, " +
    "auto-verify after file writes, and doom-loop prevention.",
  inputSchema: TASK_INPUT_SCHEMA,
};

// ---------------------------------------------------------------------------
// Conduct tool descriptor (Sprint 86)
// ---------------------------------------------------------------------------

/**
 * MCP tool descriptor for the conductor: spec-from-goal + orchestrator.
 *
 * LONG-RUNNING: spec generation + full orchestration can take 20+ minutes.
 * Non-interactive: no confirmation prompt in MCP mode.
 */
export const CONDUCT_TOOL: MCPTool = {
  name: "phase2s__conduct",
  description:
    "Generate a role-annotated DAG spec from a natural language goal and run it " +
    "through the multi-agent orchestrator. One call = spec generation + full " +
    "orchestration. LONG-RUNNING: may take 20+ minutes.",
  inputSchema: {
    type: "object",
    properties: {
      goal: {
        type: "string",
        description: "Natural language goal (e.g. 'add rate limiting to the API').",
      },
      model: {
        type: "string",
        description: "Override model for spec generation (default: config.smart_model).",
      },
      maxAttempts: {
        type: "number",
        description: "Max retry loops for the orchestrator (default: 3).",
      },
      workers: {
        type: "number",
        description: "Max parallel workers per dependency level (default: orchestrator setting).",
      },
      dryRun: {
        type: "boolean",
        description: "Generate spec and return it without running the orchestrator.",
      },
    },
    required: ["goal"],
  },
};

export const CONDUCT_STATUS_TOOL: MCPTool = {
  name: "phase2s__conduct_status",
  description:
    "Run the built-in conductor audit cases to verify spec generation quality. " +
    "Generates specs for 10 curated goals and validates structure (subtask count, " +
    "role presence, lint). Note: dashboard mode is not supported in MCP context.",
  inputSchema: {
    type: "object",
    properties: {
      fast: {
        type: "boolean",
        description: "Use fast_model instead of smart_model (cheaper; recommended for CI).",
      },
      caseId: {
        type: "string",
        description: "Run a single case by ID for debugging (e.g. 'add-endpoint').",
      },
    },
    required: [],
  },
};

export const REPORT_TOOL: MCPTool = {
  name: "phase2s__report",
  description:
    "Parse and display a human-readable summary of a Phase2S dark factory run log (.jsonl). " +
    "Shows per-attempt sub-task timeline with durations, criteria verdicts, and total run time. " +
    "Use after phase2s__goal completes — pass the runLogPath returned by phase2s__goal.",
  inputSchema: {
    type: "object",
    properties: {
      logFile: {
        type: "string",
        description: "Absolute path to the .jsonl run log file (returned by phase2s__goal as runLogPath).",
      },
    },
    required: ["logFile"],
  },
};

// ---------------------------------------------------------------------------
// Conduct-log tool descriptor (Sprint 91)
// ---------------------------------------------------------------------------

/**
 * MCP tool descriptor for querying conduct-log history and embeddings.
 *
 * Exposes three actions:
 *   - list: return the last N ConductLogEntry objects (newest first)
 *   - stats: return aggregated ConductStats (same as conduct-insights --json)
 *   - search: find top-K similar past goals using Ollama cosine similarity;
 *             falls back to recency list if Ollama is not configured
 */
export const CONDUCT_LOG_TOOL: MCPTool = {
  name: "phase2s__conduct_log",
  description:
    "Query conductor run history from .phase2s/conduct-log.jsonl. " +
    "Use 'list' to browse recent runs, 'stats' for aggregated analytics, " +
    "or 'search' to find past runs with similar goals (Ollama required for semantic search).",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["list", "stats", "search"],
        description: "Action to perform: 'list' returns recent entries, 'stats' returns aggregated analytics, 'search' finds similar past goals.",
      },
      query: {
        type: "string",
        description: "Goal text to search for similar past runs. Required when action='search'.",
      },
      limit: {
        type: "number",
        description: "Max entries to return for 'list' (default: 10). Ignored for 'stats'.",
      },
    },
    required: ["action"],
  },
};

// ---------------------------------------------------------------------------
// Notification helpers
// ---------------------------------------------------------------------------

/**
 * Build a JSON-RPC notification (no `id` field — this is a server push, not
 * a response to a request).
 */
export function buildNotification(method: string, params?: unknown): MCPNotification {
  const n: MCPNotification = { jsonrpc: "2.0", method };
  if (params !== undefined) n.params = params;
  return n;
}
