import type { ToolDefinition } from "../tools/types.js";

export function buildSystemPrompt(tools: ToolDefinition[], customPrompt?: string): string {
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

  return parts.join("\n");
}
