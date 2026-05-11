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
import { conductorGenSpec } from "../cli/conductor-prompt.js";
import { parseRunLog, buildRunReport, formatRunReport } from "../cli/report.js";
import { parseSpec } from "../core/spec-parser.js";
import { buildDependencyGraph, formatExecutionLevels } from "../goal/dependency-graph.js";
import type { Skill } from "../skills/types.js";
import { skillToTool, toolNameToSkillName, STATE_TOOLS, GOAL_TOOL, CONDUCT_TOOL, CONDUCT_STATUS_TOOL, CONDUCT_LOG_TOOL, REPORT_TOOL, TASK_TOOL, TASK_COMPAT_TOOL, MCP_SERVER_VERSION } from "./tools.js";
import { readConductLog } from "../cli/conduct-log.js";
import { computeConductStats } from "../cli/conduct-insights.js";
import { readConductIndex, searchConductIndex } from "../core/conduct-index.js";
import { generateEmbedding } from "../core/embeddings.js";

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
      result: { tools: [...skills.map(skillToTool), ...STATE_TOOLS, GOAL_TOOL, CONDUCT_TOOL, CONDUCT_STATUS_TOOL, CONDUCT_LOG_TOOL, REPORT_TOOL, TASK_TOOL, TASK_COMPAT_TOOL] },
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
    // Conduct tool — conductor: spec-from-goal + orchestrator (Sprint 86).
    // -----------------------------------------------------------------------
    if (toolName === "phase2s__conduct") {
      const goal = typeof args["goal"] === "string" ? args["goal"] : "";
      if (!goal) {
        return {
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32602, message: "phase2s__conduct: goal is required" },
        };
      }

      const model = typeof args["model"] === "string" ? args["model"] : undefined;
      const maxAttempts = typeof args["maxAttempts"] === "number" ? args["maxAttempts"] : 3;
      const dryRun = typeof args["dryRun"] === "boolean" ? args["dryRun"] : false;
      const workers = typeof args["workers"] === "number" ? args["workers"] : undefined;

      try {
        const config = preloadedConfig ?? await loadConfig();
        const { specPath, specContent } = await conductorGenSpec(goal, config, { model, cwd });

        if (!specPath) {
          return {
            jsonrpc: "2.0",
            id: request.id,
            error: { code: -32603, message: "phase2s__conduct: spec generation failed (LLM timeout or invalid output)" },
          };
        }

        const spec = parseSpec(specContent);
        const dagResult = spec.decomposition.length >= 2
          ? buildDependencyGraph(spec.decomposition)
          : null;
        const dagPreview = dagResult
          ? formatExecutionLevels(dagResult, spec.decomposition)
          : `${spec.decomposition.length} subtask(s)`;

        if (dryRun) {
          return {
            jsonrpc: "2.0",
            id: request.id,
            result: {
              content: [{
                type: "text",
                text: [
                  `Conductor spec generated (dry-run)`,
                  `Spec: ${specPath}`,
                  ``,
                  dagPreview,
                  ``,
                  `Full spec content:`,
                  specContent,
                ].join("\n"),
              }],
            },
          };
        }

        const result = await runGoal(specPath, {
          maxAttempts: String(maxAttempts),
          orchestrator: true,
          workers,
          cwd,
          quiet: true, // non-interactive MCP mode
        });

        const passCount = Object.values(result.criteriaResults).filter(Boolean).length;
        const totalCount = Object.keys(result.criteriaResults).length;
        const status = result.success ? "success" : "failed";

        return {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            content: [{
              type: "text",
              text: [
                `Conductor run: ${status}`,
                `Goal: ${goal}`,
                `Spec: ${specPath}`,
                `Attempts: ${result.attempts}`,
                totalCount > 0 ? `Criteria: ${passCount}/${totalCount} passed` : "Criteria: (none defined)",
                `Run log (absolute): ${result.runLogPath}`,
                ``,
                dagPreview,
              ].join("\n"),
            }],
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
    // Conduct status tool — structural quality gate for spec generation (Sprint 88).
    // -----------------------------------------------------------------------
    if (toolName === "phase2s__conduct_status") {
      const fast = typeof args["fast"] === "boolean" ? args["fast"] : true; // default true in MCP (cost)
      const caseId = typeof args["caseId"] === "string" ? args["caseId"] : undefined;

      try {
        const { runConductAudit } = await import("../cli/conduct-audit.js");
        const result = await runConductAudit({ fast, caseId, json: false });
        const lines: string[] = [
          `Conductor audit: ${result.passed}/${result.total} passed`,
          `Avg duration: ${(result.avgDurationMs / 1000).toFixed(1)}s/case`,
          ``,
        ];
        for (const c of result.cases) {
          const icon = c.passed ? "✓" : "✗";
          const detail = c.passed
            ? `${c.subtaskCount} subtasks, roles: ${(c.roles ?? []).join(" ")}`
            : `FAIL: ${c.error}`;
          lines.push(`  ${icon} ${c.id}: ${detail}`);
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
    // Conduct-log tool — query conduct history (Sprint 91).
    // -----------------------------------------------------------------------
    if (toolName === "phase2s__conduct_log") {
      const action = typeof args["action"] === "string" ? args["action"] : "list";
      // Always use the server's trusted cwd — never accept cwd from the caller
      // to prevent path traversal (reading arbitrary .phase2s/ directories).
      const queryCwd = cwd;
      const limit = typeof args["limit"] === "number" && args["limit"] > 0
        ? Math.min(Math.floor(args["limit"]), 1000)
        : 10;

      if (action !== "list" && action !== "stats" && action !== "search") {
        return {
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32602, message: `phase2s__conduct_log: unknown action '${action}'. Valid values: list, stats, search` },
        };
      }

      try {
        if (action === "stats") {
          const entries = await readConductLog(queryCwd, limit);
          const stats = computeConductStats(entries);
          return {
            jsonrpc: "2.0",
            id: request.id,
            result: { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] },
          };
        }

        if (action === "search") {
          const query = typeof args["query"] === "string" ? args["query"] : "";
          if (!query) {
            return {
              jsonrpc: "2.0",
              id: request.id,
              error: { code: -32602, message: "phase2s__conduct_log: query is required for action='search'" },
            };
          }

          // Try Ollama semantic search; fall back to recency list if unavailable.
          const cfg = preloadedConfig ?? (await loadConfig().catch(() => undefined));
          const baseUrl = cfg?.ollamaBaseUrl ?? "";
          const model = cfg?.ollamaEmbedModel ?? "";
          let text: string;

          if (baseUrl && model) {
            const queryVec = await generateEmbedding(query, model, baseUrl);
            if (queryVec.length > 0) {
              const index = await readConductIndex(queryCwd);
              const results = searchConductIndex(index, queryVec, limit);
              text = results.length > 0
                ? JSON.stringify(results.map((r) => ({
                    id: r.id,
                    goalSnippet: r.goalSnippet,
                    success: r.success,
                    durationMs: r.durationMs,
                    subtaskCount: r.subtaskCount,
                    similarity: Math.round(r.similarity * 1000) / 1000,
                  })), null, 2)
                : "No similar entries found in conduct index. Run `phase2s conduct-insights --rebuild-index` to populate it.";
            } else {
              // Ollama returned empty — fall back to recency
              const entries = await readConductLog(queryCwd, limit);
              text = JSON.stringify(entries, null, 2) + "\n\n(Note: Ollama embedding unavailable — showing recent entries instead of semantic search results)";
            }
          } else {
            // Ollama not configured — fall back to recency
            const entries = await readConductLog(queryCwd, limit);
            text = JSON.stringify(entries, null, 2) + "\n\n(Note: ollamaBaseUrl/ollamaEmbedModel not configured — showing recent entries instead of semantic search results)";
          }

          return {
            jsonrpc: "2.0",
            id: request.id,
            result: { content: [{ type: "text", text }] },
          };
        }

        // Default: action === "list"
        const entries = await readConductLog(queryCwd, limit);
        return {
          jsonrpc: "2.0",
          id: request.id,
          result: { content: [{ type: "text", text: JSON.stringify(entries, null, 2) }] },
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
    // Task tool — autonomous task executor (Sprint 84).
    // phase2s__task is a backward-compat alias (Sprint 93).
    // -----------------------------------------------------------------------
    if (toolName === "phase2s__go" || toolName === "phase2s__task") {
      const task = typeof args["task"] === "string" ? args["task"] : "";
      if (!task) {
        return {
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32602, message: "phase2s__go: task is required" },
        };
      }
      const verifyCommand = typeof args["verify_command"] === "string" ? args["verify_command"] : undefined;

      try {
        const config = preloadedConfig ?? await loadConfig();
        const agent = new Agent({ config, agentsMdBlock });

        const result = await agent.run(task, {
          taskMode: true,
          verifyCommand: verifyCommand ?? config.verifyCommand,
        });

        return {
          jsonrpc: "2.0",
          id: request.id,
          result: { content: [{ type: "text", text: result }] },
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
