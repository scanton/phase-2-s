/**
 * Context compaction — replace a long conversation history with a structured summary.
 *
 * Calls the current session's provider via chatStream() to generate a summary,
 * then returns the summary string. The caller is responsible for:
 *   1. Writing a backup of the session before replacing messages.
 *   2. Replacing agent conversation messages with a single [COMPACTED CONTEXT] message.
 *   3. Persisting the updated session via saveSession().
 *
 * A 30-second AbortSignal is applied to the stream call so a slow/unresponsive
 * provider doesn't stall the REPL indefinitely.
 */

import type { Provider, Message } from "../providers/types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Sentinel prefix added to the user message that replaces compacted history.
 * Detecting this prefix lets code distinguish compacted from live sessions.
 */
export const COMPACTED_CONTEXT_MARKER = "[COMPACTED CONTEXT]";

export const COMPACT_SUMMARY_PROMPT = `Summarize this conversation in structured form, capturing:
- Files created or modified (with key changes)
- Decisions made and reasoning
- Errors encountered and how they were resolved
- Current goal and what was being worked on when this summary was requested
- Any important context the next session should know

Be thorough — this summary will replace the full conversation history.`;

// ---------------------------------------------------------------------------
// Pure utility functions (testable without mocking the provider)
// ---------------------------------------------------------------------------

/**
 * Determine whether auto-compaction should fire given the current token count
 * and the configured threshold.
 *
 * @param tokens     Estimated token count (from Conversation.estimateTokens()).
 * @param threshold  auto_compact_tokens config value (0 / undefined = disabled).
 */
export function shouldCompact(tokens: number, threshold: number | undefined): boolean {
  if (!threshold) return false; // 0 and undefined both mean "disabled"
  return tokens >= threshold;
}

/**
 * Derive the backup file path from a session file path.
 * Replaces the `.json` extension with `.compact-backup.json`.
 *
 * @param sessionPath  Absolute path to the active session JSON file.
 */
export function getCompactBackupPath(sessionPath: string): string {
  return sessionPath.replace(/\.json$/, ".compact-backup.json");
}

/**
 * Build the compacted message list from the original messages and the LLM summary.
 *
 * Keeps any system-role messages unchanged (they hold instructions/persona).
 * Prepends a single user-role message with the COMPACTED_CONTEXT_MARKER so the
 * next LLM call understands the history has been summarized.
 *
 * @param messages  Full conversation history (may include system messages).
 * @param summary   The compaction summary returned by buildCompactionSummary().
 */
export function buildCompactedMessages(messages: Message[], summary: string): Message[] {
  return [
    ...messages.filter((m) => m.role === "system"),
    { role: "user", content: `${COMPACTED_CONTEXT_MARKER}\n${summary}` },
  ];
}

// ---------------------------------------------------------------------------
// buildCompactionSummary
// ---------------------------------------------------------------------------

/**
 * Call the provider to summarize the given messages.
 *
 * Returns the summary string. Returns an empty string if the provider yields
 * no text content (caller should treat empty as a failed compaction).
 *
 * Throws if the provider raises an error — caller should catch, warn, and
 * continue without compacting.
 *
 * @param provider  The active session provider.
 * @param messages  Full conversation history to summarize.
 */
export async function buildCompactionSummary(
  provider: Provider,
  messages: Message[],
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);

  // If the last message is already a user message, omit it before appending the
  // compaction prompt — some providers reject consecutive user-role messages.
  const base = messages.length > 0 && messages[messages.length - 1].role === "user"
    ? messages.slice(0, -1)
    : messages;

  const compactionMessages: Message[] = [
    ...base,
    {
      role: "user",
      content: COMPACT_SUMMARY_PROMPT,
    },
  ];

  let summary = "";

  try {
    const stream = provider.chatStream(compactionMessages, [], {
      signal: controller.signal,
    });

    for await (const event of stream) {
      if (event.type === "text") {
        summary += event.content;
      } else if (event.type === "error") {
        throw new Error(event.error);
      }
      // "done" and "tool_calls" events are ignored — compaction prompt never invokes tools.
    }
  } finally {
    clearTimeout(timer);
  }

  return summary;
}
