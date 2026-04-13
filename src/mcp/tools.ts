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

export const MCP_SERVER_VERSION = "0.18.0";

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
