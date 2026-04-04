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
  | { type: "error"; error: string };

export interface ChatStreamOptions {
  model?: string;
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
