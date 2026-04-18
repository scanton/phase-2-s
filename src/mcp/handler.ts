/**
 * MCP request handler.
 *
 * Extracted from server.ts (Sprint 52 decomposition).
 * Contains handleRequest — the bulk of the MCP protocol logic (~278 lines).
 */

import { loadConfig, type Config } from "../core/config.js";
import { Agent } from "../core/agent.js";
import { Conversation } from "../core/conversation.js";
import { substituteInputs, stripAskTokens } from "../skills/template.js";
import { readRawState, writeRawState, clearRawState } from "../core/state.js";
import { runGoal } from "../cli/goal.js";
import { parseRunLog, buildRunReport, formatRunReport } from "../cli/report.js";
import type { Skill } from "../skills/types.js";
import { skillToTool, toolNameToSkillName, STATE_TOOLS, GOAL_TOOL, REPORT_TOOL, MCP_SERVER_VERSION } from "./tools.js";

// ---------------------------------------------------------------------------
// Types (re-exported for handler consumers)
// ---------------------------------------------------------------------------

export interface JSONRPCRequest {
  jsonrpc: "2.0";
  id: number | string | null;
  method: string;
  params?: unknown;
}

export interface JSONRPCResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

// ---------------------------------------------------------------------------
// Request handler
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
 * @param preloadedConfig      Pre-loaded config from server startup. When provided,
 *                             avoids the per-request disk read. Tests omit this param
 *                             to use the default loadConfig() path.
 * @param agentsMdBlock        Pre-formatted AGENTS.md block from server startup.
 *                             Loaded once in runMCPServer() to avoid per-request disk
 *                             reads. Undefined when no AGENTS.md is present.
 */
export async function handleRequest(
  request: JSONRPCRequest,
  skills: Skill[],
  cwd: string,
  sessionConversations?: Map<string, Conversation>,
  preloadedConfig?: Config,
  agentsMdBlock?: string,
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
      result: { tools: [...skills.map(skillToTool), ...STATE_TOOLS, GOAL_TOOL, REPORT_TOOL] },
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
    // Goal tool — dark factory executor.
    // -----------------------------------------------------------------------
    if (toolName === "phase2s__goal") {
      const specFile = typeof args["specFile"] === "string" ? args["specFile"] : "";
      if (!specFile) {
        return {
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32602, message: "phase2s__goal: specFile is required" },
        };
      }
      try {
        const result = await runGoal(specFile, {
          maxAttempts: typeof args["maxAttempts"] === "number" ? String(args["maxAttempts"]) : undefined,
          resume: typeof args["resume"] === "boolean" ? args["resume"] : undefined,
          reviewBeforeRun: typeof args["reviewBeforeRun"] === "boolean" ? args["reviewBeforeRun"] : undefined,
          notify: typeof args["notify"] === "boolean" ? args["notify"] : undefined,
        });

        const passCount = Object.values(result.criteriaResults).filter(Boolean).length;
        const totalCount = Object.keys(result.criteriaResults).length;
        const status = result.challenged
          ? (result.challengeResponse?.includes("NEEDS_CLARIFICATION") ? "needs_clarification" : "challenged")
          : result.success
            ? "success"
            : "failed";

        const lines = [
          `Goal run: ${status}`,
          `Spec: ${specFile}`,
          `Attempts: ${result.attempts}`,
          totalCount > 0 ? `Criteria: ${passCount}/${totalCount} passed` : "Criteria: (none defined)",
          `Run log (absolute): ${result.runLogPath}`,
        ];

        if (result.challenged && result.challengeResponse) {
          lines.push("", "Adversarial review response:", result.challengeResponse);
        }

        return {
          jsonrpc: "2.0",
          id: request.id,
          result: { content: [{ type: "text", text: lines.join("\n") }] },
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
    // Report tool — dark factory run log viewer.
    // -----------------------------------------------------------------------
    if (toolName === "phase2s__report") {
      const logFile = typeof args["logFile"] === "string" ? args["logFile"] : "";
      if (!logFile) {
        return {
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32602, message: "phase2s__report: logFile is required" },
        };
      }
      try {
        const events = parseRunLog(logFile);
        const report = buildRunReport(events);
        const text = formatRunReport(report);
        return {
          jsonrpc: "2.0",
          id: request.id,
          result: { content: [{ type: "text", text }] },
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
    // Compare MCP tool names directly (avoids the lossy hyphen→underscore→hyphen
    // round-trip that toolNameToSkillName() can't always reverse — e.g. a skill
    // named "my_skill" would incorrectly map back to "my-skill").
    // Fall back to the old derivation for any edge case not covered by skillToTool.
    const skill =
      skills.find((s) => skillToTool(s).name === toolName) ??
      skills.find((s) => s.name === toolNameToSkillName(toolName));
    const skillName = skill?.name ?? toolNameToSkillName(toolName);

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
      // Use pre-loaded config if available (avoids per-request disk read).
      // Tests that call handleRequest directly omit preloadedConfig and
      // fall back to the default loadConfig() path.
      const config = preloadedConfig ?? await loadConfig();

      // Session persistence: look up an existing Conversation for this skill.
      // On the first call the map has no entry and Agent creates a fresh one.
      // On subsequent calls the Agent resumes where it left off.
      const existingConversation = sessionConversations?.get(skillName);
      const agent = new Agent({ config, conversation: existingConversation, agentsMdBlock });

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
