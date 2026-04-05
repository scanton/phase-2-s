/**
 * Phase2S MCP server.
 *
 * Implements the Model Context Protocol (JSON-RPC 2.0 over stdio) so that
 * Claude Code can invoke Phase2S skills as tools. Every SKILL.md file in
 * .phase2s/skills/ becomes a Claude Code tool dynamically at server startup.
 *
 * Transport: stdio (one JSON message per line, responses on stdout).
 * Protocol: MCP 2024-11-05.
 *
 * Start via: phase2s mcp
 * Configure in: .claude/settings.json
 */

import { createInterface } from "node:readline";
import { watch } from "node:fs";
import { loadSkillsFromDir } from "../skills/loader.js";
import { loadConfig } from "../core/config.js";
import { Agent } from "../core/agent.js";
import { Conversation } from "../core/conversation.js";
import { substituteInputs, stripAskTokens } from "../skills/template.js";
import { readRawState, writeRawState, clearRawState } from "../core/state.js";
import { join } from "node:path";
import type { Skill } from "../skills/types.js";

export const MCP_SERVER_VERSION = "0.18.0";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface JSONRPCRequest {
  jsonrpc: "2.0";
  id: number | string | null;
  method: string;
  params?: unknown;
}

interface JSONRPCResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

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

// ---------------------------------------------------------------------------
// Skills watcher (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Watch the skills directory for new SKILL.md files. When a change is
 * detected (debounced 80ms), reload skills and call notify() so the server
 * can send a notifications/tools/list_changed message to the MCP client.
 *
 * Silently skips watching if the directory does not exist.
 */
export function setupSkillsWatcher(
  skillsDir: string,
  onReload: (skills: Skill[]) => void,
  notify: () => void,
): void {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  try {
    watch(skillsDir, { persistent: false }, () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        loadSkillsFromDir(skillsDir)
          .then((updated) => {
            onReload(updated);
            notify();
          })
          .catch(() => {
            // Reload errors are silently ignored — stale skill list is better
            // than crashing the server.
          });
      }, 80);
    });
  } catch {
    // Skills directory doesn't exist or isn't watchable — skip silently.
    // The server still works, just without hot-reload.
  }
}

// ---------------------------------------------------------------------------
// Request handler (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Handle a single JSON-RPC request and return the response.
 *
 * Exported so tests can call it directly without stdio.
 *
 * @param request              Parsed JSON-RPC request
 * @param skills               Loaded Phase2S skills (passed in so tests can inject fixtures)
 * @param cwd                  Working directory for config loading and agent runs
 * @param sessionConversations Optional per-skill conversation map for session persistence.
 *                             When provided, tools/call reuses the existing Conversation
 *                             for each skill across multiple invocations rather than
 *                             starting cold every call.
 */
export async function handleRequest(
  request: JSONRPCRequest,
  skills: Skill[],
  cwd: string,
  sessionConversations?: Map<string, Conversation>,
): Promise<JSONRPCResponse> {
  // -----------------------------------------------------------------------
  // initialize
  // -----------------------------------------------------------------------
  if (request.method === "initialize") {
    return {
      jsonrpc: "2.0",
      id: request.id,
      result: {
        protocolVersion: "2024-11-05",
        // listChanged: true tells the client to re-fetch tools/list when it
        // receives a notifications/tools/list_changed notification.
        capabilities: { tools: { listChanged: true } },
        serverInfo: { name: "phase2s", version: MCP_SERVER_VERSION },
      },
    };
  }

  // -----------------------------------------------------------------------
  // tools/list
  // -----------------------------------------------------------------------
  if (request.method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id: request.id,
      result: { tools: [...skills.map(skillToTool), ...STATE_TOOLS] },
    };
  }

  // -----------------------------------------------------------------------
  // tools/call
  // -----------------------------------------------------------------------
  if (request.method === "tools/call") {
    const params = request.params as { name?: string; arguments?: Record<string, unknown> } | undefined;
    const toolName = params?.name ?? "";
    const args = params?.arguments ?? {};

    // -----------------------------------------------------------------------
    // State tools — handled before skill lookup.
    // -----------------------------------------------------------------------
    if (toolName === "phase2s__state_write") {
      const key = String(args["key"] ?? "");
      const value = args["value"];
      if (!key) {
        return { jsonrpc: "2.0", id: request.id, error: { code: -32602, message: "state_write: key is required" } };
      }
      writeRawState(cwd, key, value);
      return {
        jsonrpc: "2.0",
        id: request.id,
        result: { content: [{ type: "text", text: `State written for key: ${key}` }] },
      };
    }

    if (toolName === "phase2s__state_read") {
      const key = String(args["key"] ?? "");
      if (!key) {
        return { jsonrpc: "2.0", id: request.id, error: { code: -32602, message: "state_read: key is required" } };
      }
      const value = readRawState(cwd, key);
      return {
        jsonrpc: "2.0",
        id: request.id,
        result: { content: [{ type: "text", text: JSON.stringify(value) }] },
      };
    }

    if (toolName === "phase2s__state_clear") {
      const key = String(args["key"] ?? "");
      if (!key) {
        return { jsonrpc: "2.0", id: request.id, error: { code: -32602, message: "state_clear: key is required" } };
      }
      clearRawState(cwd, key);
      return {
        jsonrpc: "2.0",
        id: request.id,
        result: { content: [{ type: "text", text: `State cleared for key: ${key}` }] },
      };
    }

    // -----------------------------------------------------------------------
    // Skill tools — look up by name.
    // -----------------------------------------------------------------------
    const skillName = toolNameToSkillName(toolName);
    const skill = skills.find((s) => s.name === skillName);

    if (!skill) {
      return {
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32601, message: `Tool not found: ${toolName}` },
      };
    }

    const userPrompt = typeof args["prompt"] === "string" ? args["prompt"] : "";
    // Extract declared input values from tool call arguments and substitute
    // them into the template. Unknown {{tokens}} pass through unchanged.
    const inputValues: Record<string, string> = {};
    if (skill.inputs) {
      for (const key of Object.keys(skill.inputs)) {
        if (args[key] !== undefined && args[key] !== null) {
          // Stringify all input types before substitution — boolean, number, enum all become strings
          inputValues[key] = String(args[key]);
        }
      }
    }
    let substitutedTemplate = substituteInputs(skill.promptTemplate, inputValues, skill.inputs);

    // Strip {{ASK:}} tokens — MCP cannot do interactive prompting.
    // Surface degradation in the result so the caller knows questions were skipped.
    const { result: strippedTemplate, stripped: hadAskTokens } = stripAskTokens(substitutedTemplate);
    substitutedTemplate = strippedTemplate;

    // Prepend the (substituted) skill prompt to the user's content
    const fullPrompt = substitutedTemplate + (userPrompt ? `\n\n## Input\n\n${userPrompt}` : "");

    try {
      const config = await loadConfig();

      // Session persistence: look up an existing Conversation for this skill.
      // On the first call the map has no entry and Agent creates a fresh one.
      // On subsequent calls the Agent resumes where it left off.
      const existingConversation = sessionConversations?.get(skillName);
      const agent = new Agent({ config, conversation: existingConversation });

      const text = await agent.run(fullPrompt, { modelOverride: skill.model });

      // Store the (possibly updated) conversation back into the session map
      // so the next call to this skill can continue the conversation.
      if (sessionConversations) {
        sessionConversations.set(skillName, agent.getConversation());
      }

      // If {{ASK:}} tokens were stripped, surface a degradation note so the
      // MCP caller (e.g. Claude Code) knows the skill ran without interactive input.
      const content: Array<{ type: string; text: string }> = [{ type: "text", text }];
      if (hadAskTokens) {
        content.push({
          type: "text",
          text: `\n\n[PHASE2S_NOTE: This skill contains interactive {{ASK:}} prompts that were skipped in MCP mode. Run interactively via the Phase2S REPL for full behaviour.]`,
        });
      }

      return {
        jsonrpc: "2.0",
        id: request.id,
        result: { content },
      };
    } catch (err) {
      return {
        jsonrpc: "2.0",
        id: request.id,
        error: {
          code: -32603,
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  // -----------------------------------------------------------------------
  // Unknown method
  // -----------------------------------------------------------------------
  return {
    jsonrpc: "2.0",
    id: request.id,
    error: { code: -32601, message: `Method not found: ${request.method}` },
  };
}

// ---------------------------------------------------------------------------
// Server entry point
// ---------------------------------------------------------------------------

/**
 * Start the MCP server. Reads JSON-RPC messages from stdin, writes responses
 * to stdout. Runs until stdin closes (i.e. Claude Code terminates the session).
 *
 * Uses a manual event-queue pattern (same as the CLI REPL) to avoid the known
 * issue where the readline async iterator terminates if the event loop drains
 * while awaiting between messages.
 */
export async function runMCPServer(cwd: string): Promise<void> {
  const skillsDir = join(cwd, ".phase2s", "skills");
  let skills = await loadSkillsFromDir(skillsDir);

  // One Conversation per skill, scoped to this process lifetime (= one Claude
  // Code project session). Multi-turn skills like /satori and /consensus-plan
  // resume where they left off rather than starting cold on every tools/call.
  const sessionConversations = new Map<string, Conversation>();

  const respond = (message: JSONRPCResponse | MCPNotification): void => {
    process.stdout.write(JSON.stringify(message) + "\n");
  };

  // Watch for new skills added mid-session (e.g. via /skill). When detected,
  // reload the skills list and notify the MCP client so it re-fetches tools/list.
  setupSkillsWatcher(
    skillsDir,
    (updated) => {
      skills = updated;
    },
    () => {
      respond(buildNotification("notifications/tools/list_changed"));
    },
  );

  // Manual event queue — safer than readline async iterator for long-lived servers
  const lineQueue: string[] = [];
  let pendingResolve: ((line: string | null) => void) | null = null;
  let isOpen = true;

  const rl = createInterface({ input: process.stdin, terminal: false });

  rl.on("line", (line) => {
    if (pendingResolve) {
      const resolve = pendingResolve;
      pendingResolve = null;
      resolve(line);
    } else {
      lineQueue.push(line);
    }
  });

  rl.on("close", () => {
    isOpen = false;
    if (pendingResolve) {
      pendingResolve(null);
      pendingResolve = null;
    }
    // Force exit so any in-flight codex subprocess doesn't keep us alive after
    // Claude Code has closed the connection. The "exit" event still fires on
    // process.exit(), so codex.ts cleanupTempDirs() runs before we die.
    process.exit(0);
  });

  const nextLine = (): Promise<string | null> => {
    if (lineQueue.length > 0) return Promise.resolve(lineQueue.shift()!);
    if (!isOpen) return Promise.resolve(null);
    return new Promise((resolve) => {
      pendingResolve = resolve;
    });
  };

  while (true) {
    const line = await nextLine();
    if (line === null) break; // stdin closed

    const trimmed = line.trim();
    if (!trimmed) continue;

    let request: JSONRPCRequest;
    try {
      request = JSON.parse(trimmed);
    } catch {
      respond({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      });
      continue;
    }

    const response = await handleRequest(request, skills, cwd, sessionConversations);
    respond(response);
  }
}
