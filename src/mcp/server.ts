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
 *
 * This file is the barrel entry point. Implementation is split across:
 *   src/mcp/tools.ts   — tool descriptors and conversion utilities
 *   src/mcp/watcher.ts — skills directory hot-reload watcher
 *   src/mcp/handler.ts — JSON-RPC request handler
 */

import { createInterface } from "node:readline";
import { loadSkillsFromDir } from "../skills/loader.js";
import { join } from "node:path";
import { Conversation } from "../core/conversation.js";
import { handleRequest, type JSONRPCRequest } from "./handler.js";
import { loadConfig } from "../core/config.js";
import { loadAgentsMd, formatAgentsMdBlock } from "../core/agents-md.js";
import { buildNotification, MCP_SERVER_VERSION } from "./tools.js";
import { setupSkillsWatcher } from "./watcher.js";

// ---------------------------------------------------------------------------
// Barrel re-exports — test/mcp/server.test.ts imports these from server.js
// ---------------------------------------------------------------------------

export type { MCPTool, MCPNotification } from "./tools.js";
export type { JSONRPCRequest, JSONRPCResponse } from "./handler.js";
export {
  MCP_SERVER_VERSION,
  skillToTool,
  toolNameToSkillName,
  STATE_TOOLS,
  GOAL_TOOL,
  REPORT_TOOL,
  buildNotification,
} from "./tools.js";
export { handleRequest } from "./handler.js";
export { setupSkillsWatcher } from "./watcher.js";

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

  // Load config once at startup — avoids per-request disk reads in handleRequest.
  // If config loading fails, fall back to undefined so handleRequest uses loadConfig().
  const serverConfig = await loadConfig().catch(() => undefined);

  // Load AGENTS.md once at startup — avoids per-request disk reads in handleRequest.
  // Changes during a running MCP session require server restart (same as config changes).
  // ENOENT is silent (file absent). Non-ENOENT errors are surfaced to stderr so
  // permission issues don't silently disappear (stderr doesn't corrupt JSON-RPC stdout).
  const agentsMdContent = await loadAgentsMd(cwd).catch((err: unknown) => {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      process.stderr.write(`[phase2s] Warning: could not load AGENTS.md (${code ?? "unknown"}) — skipping.\n`);
    }
    return undefined;
  });
  const preloadedAgentsMdBlock = agentsMdContent ? formatAgentsMdBlock(agentsMdContent) : undefined;

  // One Conversation per skill, scoped to this process lifetime (= one Claude
  // Code project session). Multi-turn skills like /satori and /consensus-plan
  // resume where they left off rather than starting cold every tools/call.
  const sessionConversations = new Map<string, Conversation>();

  const respond = (message: object): void => {
    process.stdout.write(JSON.stringify(message) + "\n");
  };

  // Watch for new skills added mid-session (e.g. via /skill). When detected,
  // reload the skills list and notify the MCP client so it re-fetches tools/list.
  // Store the handle so we can close it cleanly on shutdown (prevents watcher
  // pile-up if runMCPServer is called multiple times in tests or future restarts).
  const watcher = setupSkillsWatcher(
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
    // Close the watcher before exiting so it doesn't accumulate across restarts.
    watcher?.close();
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

    let response;
    try {
      response = await handleRequest(request, skills, cwd, sessionConversations, serverConfig, preloadedAgentsMdBlock);
    } catch (err) {
      // Guard against uncaught throws from handleRequest (e.g. EACCES/ENOSPC on
      // state_write). Return a JSON-RPC internal error rather than crashing the server.
      respond({
        jsonrpc: "2.0",
        id: (request as { id?: unknown }).id ?? null,
        error: { code: -32603, message: `Internal error: ${err instanceof Error ? err.message : String(err)}` },
      });
      continue;
    }
    respond(response);
  }
}
