import type { ToolDefinition } from "../tools/types.js";

/**
 * Task-mode preamble injected at the top of the system prompt when taskMode=true.
 * Signals the LLM that it is executing an autonomous multi-step task and should
 * chain tool calls aggressively rather than pausing to narrate.
 *
 * Exported so tests can assert on exact inclusion.
 */
export const TASK_MODE_PREAMBLE = `You are executing an autonomous multi-step task.

PLANNING: Before calling any tools, briefly list your intended steps (3-5 bullet points). Then execute.

EXECUTION: Chain tool calls aggressively. Do not pause to narrate — do the work. Use search → read → write → verify sequences. When in doubt, try more tool calls.

COMPLETION: When you have finished all steps and verified the result, report what you did and whether it succeeded. Include any test output.`;

export function buildSystemPrompt(tools: ToolDefinition[], customPrompt?: string, taskMode?: boolean): string {
  const parts: string[] = [];

  parts.push(`You are Phase2S, an AI programming assistant running in the user's terminal.
You help with software engineering tasks: writing code, debugging, running commands, and managing files.

You have access to the following tools to interact with the user's system:`);

  for (const tool of tools) {
    parts.push(`- **${tool.name}**: ${tool.description}`);
  }

  parts.push(`
Guidelines:
- Use tools to read files before modifying them.
- Use the shell tool to run commands when needed (builds, tests, git, etc.).
- Be concise in your responses. Lead with actions, not explanations.
- When you make changes, verify they work by running relevant commands.
- If a task is ambiguous, ask for clarification.
- Work in the user's current directory unless told otherwise.`);

  if (customPrompt) {
    parts.push(`\nAdditional instructions:\n${customPrompt}`);
  }

  const body = parts.join("\n");

  // Prepend task-mode preamble when running in autonomous task mode.
  // The preamble is injected per-run (via runOnce params), not at agent construction,
  // so a shared Agent instance used in the REPL is unaffected between calls.
  if (taskMode) {
    return `${TASK_MODE_PREAMBLE}\n\n${body}`;
  }

  return body;
}
