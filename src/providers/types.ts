import type { OpenAIFunctionDef } from "../tools/types.js";

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string; // JSON string
}

export type ProviderEvent =
  | { type: "text"; content: string }
  | { type: "tool_calls"; calls: ToolCall[] }
  | { type: "done"; stopReason: string }
  | { type: "error"; error: string }
  /** Provider was rate-limited (HTTP 429). Auto-backoff budget exhausted or delay too long.
   * agent.ts catches this and throws RateLimitError, which propagates to the REPL or goal runner
   * for checkpointing and a clean exit. */
  | { type: "rate_limited"; retryAfter?: number };

export interface ChatStreamOptions {
  model?: string;
  /** AbortSignal for cooperative cancellation. When aborted, chatStream() cancels the
   * in-flight HTTP request or spawned process and stops yielding events. */
  signal?: AbortSignal;
}

export interface Provider {
  name: string;

  /** Stream response events: text deltas, tool_calls, done, or error. */
  chatStream(
    messages: Message[],
    tools: OpenAIFunctionDef[],
    options?: ChatStreamOptions,
  ): AsyncIterable<ProviderEvent>;
}
