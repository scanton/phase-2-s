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
import { loadSkillsFromDir } from "../skills/loader.js";
import { loadConfig } from "../core/config.js";
import { Agent } from "../core/agent.js";
import { join } from "node:path";
import type { Skill } from "../skills/types.js";

export const MCP_SERVER_VERSION = "0.12.0";

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
  return {
    name: `phase2s__${skill.name.replace(/-/g, "_")}`,
    description: skill.description || `Run the ${skill.name} skill`,
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: `Task or content for the ${skill.name} skill. Paste the text you want analyzed or acted on.`,
        },
      },
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
// Request handler (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Handle a single JSON-RPC request and return the response.
 *
 * Exported so tests can call it directly without stdio.
 *
 * @param request  Parsed JSON-RPC request
 * @param skills   Loaded Phase2S skills (passed in so tests can inject fixtures)
 * @param cwd      Working directory for config loading and agent runs
 */
export async function handleRequest(
  request: JSONRPCRequest,
  skills: Skill[],
  cwd: string,
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
        capabilities: { tools: {} },
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
      result: { tools: skills.map(skillToTool) },
    };
  }

  // -----------------------------------------------------------------------
  // tools/call
  // -----------------------------------------------------------------------
  if (request.method === "tools/call") {
    const params = request.params as { name?: string; arguments?: { prompt?: string } } | undefined;
    const toolName = params?.name ?? "";
    const skillName = toolNameToSkillName(toolName);
    const skill = skills.find((s) => s.name === skillName);

    if (!skill) {
      return {
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32601, message: `Tool not found: ${toolName}` },
      };
    }

    const userPrompt = params?.arguments?.prompt ?? "";
    // Prepend the skill's system prompt to the user's content
    const fullPrompt = skill.promptTemplate + (userPrompt ? `\n\n## Input\n\n${userPrompt}` : "");

    try {
      const config = await loadConfig();
      const agent = new Agent({ config });
      const text = await agent.run(fullPrompt, { modelOverride: skill.model });
      return {
        jsonrpc: "2.0",
        id: request.id,
        result: {
          content: [{ type: "text", text }],
        },
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
  const skills = await loadSkillsFromDir(skillsDir);

  const respond = (response: JSONRPCResponse): void => {
    process.stdout.write(JSON.stringify(response) + "\n");
  };

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

    const response = await handleRequest(request, skills, cwd);
    respond(response);
  }
}
