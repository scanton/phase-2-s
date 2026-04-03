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

export interface Provider {
  name: string;

  /** Send messages and get a response, potentially with tool calls */
  chat(
    messages: Message[],
    tools: OpenAIFunctionDef[],
  ): Promise<{ text: string; toolCalls: ToolCall[] }>;
}
