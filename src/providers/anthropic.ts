import Anthropic from "@anthropic-ai/sdk";
import type { Config } from "../core/config.js";
import type { Provider, Message, ToolCall, ProviderEvent, ChatStreamOptions } from "./types.js";
import type { OpenAIFunctionDef } from "../tools/types.js";
import { log } from "../utils/logger.js";

/**
 * Anthropic message format used internally for the API call.
 * Exported for testing translateMessages() directly.
 */
export type AnthropicMessage =
  | { role: "user"; content: string | AnthropicContentBlock[] }
  | { role: "assistant"; content: string | AnthropicContentBlock[] };

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string };

/**
 * Translate Phase2S Message[] into Anthropic's message format.
 *
 * Key differences from OpenAI:
 *  - System messages are extracted to a top-level `system` param (not in messages array)
 *  - No `tool` role — tool results are `tool_result` content blocks inside a `user` message
 *  - Consecutive tool results fold into a single synthetic user message (one turn = one message)
 *  - Assistant messages with tool calls become `tool_use` content blocks
 *
 * Message flow:
 *
 *   Phase2S role      →  Anthropic format
 *   ─────────────────────────────────────────────────────────────────
 *   "system"          →  (extracted — call getSystemPrompt() separately)
 *   "user"            →  { role: "user", content: string }
 *   "assistant"       →  { role: "assistant", content: string }
 *   "assistant" + tc  →  { role: "assistant", content: [text_block, ...tool_use blocks] }
 *   "tool"            →  fold into { role: "user", content: [tool_result, ...] }
 *   consecutive tools →  fold into SAME synthetic user message (multi-tool turn)
 *
 * Exported for direct unit testing.
 */
export function translateMessages(messages: Message[]): AnthropicMessage[] {
  const result: AnthropicMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      // System messages are handled separately — skip here
      continue;
    }

    if (msg.role === "tool") {
      // Fold consecutive tool results into a single synthetic user message.
      // Anthropic requires all results from one assistant tool-call turn to be
      // in the same user message (no interleaved assistant messages between them).
      const toolResult: AnthropicContentBlock = {
        type: "tool_result",
        tool_use_id: msg.toolCallId ?? "",
        content: msg.content,
      };

      const last = result[result.length - 1];
      if (last && last.role === "user" && Array.isArray(last.content) &&
          last.content.length > 0 && last.content[0].type === "tool_result") {
        // Append to existing synthetic user message
        (last.content as AnthropicContentBlock[]).push(toolResult);
      } else {
        // Start a new synthetic user message
        result.push({ role: "user", content: [toolResult] });
      }
      continue;
    }

    if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
      // Assistant turn that called tools: text block + tool_use blocks
      const content: AnthropicContentBlock[] = [];
      if (msg.content) {
        content.push({ type: "text", text: msg.content });
      }
      for (const tc of msg.toolCalls) {
        let input: unknown = {};
        try {
          input = JSON.parse(tc.arguments);
        } catch {
          input = {};
        }
        content.push({ type: "tool_use", id: tc.id, name: tc.name, input });
      }
      result.push({ role: "assistant", content });
      continue;
    }

    // Plain user or assistant message
    result.push({
      role: msg.role as "user" | "assistant",
      content: msg.content,
    });
  }

  return result;
}

/**
 * Anthropic provider — implements Provider using @anthropic-ai/sdk.
 *
 * Streaming event translation (SDK 0.39):
 *   content_block_start (tool_use) → begin accumulating tool call by index
 *   content_block_delta (text)     → yield { type: "text" }
 *   content_block_delta (json)     → append to tool arguments string
 *   content_block_stop             → no emission (all tools flushed at message_stop)
 *   message_delta (stop_reason)    → capture stop reason
 *   message_stop                   → flush all tool calls, yield { type: "done" }
 *
 * Tool calls are flushed at message_stop (not content_block_stop) to avoid partial
 * emission in multi-tool turns where each tool fires its own content_block_stop.
 */
export class AnthropicProvider implements Provider {
  name = "anthropic";
  private client: Anthropic;
  private model: string;
  private maxTokens: number;

  constructor(config: Config, client?: Anthropic) {
    const apiKey = config.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!client && !apiKey) {
      throw new Error(
        "Anthropic API key is required. Set ANTHROPIC_API_KEY env var or anthropicApiKey in .phase2s.yaml",
      );
    }
    this.client = client ?? new Anthropic({ apiKey });
    this.model = config.model ?? "claude-3-5-sonnet-20241022";
    this.maxTokens = config.anthropicMaxTokens ?? 8192;
    log.info(`AnthropicProvider: model=${this.model} maxTokens=${this.maxTokens}`);
  }

  async *chatStream(
    messages: Message[],
    tools: OpenAIFunctionDef[],
    options?: ChatStreamOptions,
  ): AsyncIterable<ProviderEvent> {
    const systemMsg = messages.find((m) => m.role === "system");
    const chatMessages = messages.filter((m) => m.role !== "system");

    const anthropicTools = tools.map((t) => ({
      name: t.function.name,
      description: t.function.description ?? "",
      input_schema: t.function.parameters as Record<string, unknown>,
    }));

    const model = options?.model ?? this.model;

    const stream = this.client.messages.stream({
      model,
      max_tokens: this.maxTokens,
      ...(systemMsg ? { system: systemMsg.content } : {}),
      messages: translateMessages(chatMessages),
      ...(anthropicTools.length > 0 ? { tools: anthropicTools } : {}),
    });

    // pendingTools accumulates tool call data by content block index.
    // Flushed at message_stop (not content_block_stop) to handle multi-tool turns correctly.
    const pendingTools = new Map<number, ToolCall>();
    let stopReason = "stop";

    for await (const event of stream) {
      if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
        pendingTools.set(event.index, {
          id: event.content_block.id,
          name: event.content_block.name,
          arguments: "",
        });
      } else if (event.type === "content_block_delta") {
        if (event.delta.type === "input_json_delta") {
          const tool = pendingTools.get(event.index);
          if (tool) tool.arguments += event.delta.partial_json;
        } else if (event.delta.type === "text_delta") {
          yield { type: "text", content: event.delta.text };
        }
      } else if (event.type === "message_delta") {
        if (event.delta.stop_reason === "tool_use") {
          stopReason = "tool_calls";
        } else if (event.delta.stop_reason === "max_tokens") {
          log.warn("Response truncated (stop_reason: max_tokens). Consider raising anthropicMaxTokens.");
          yield { type: "text", content: "\n\n[Note: response was truncated]" };
          stopReason = "length";
        }
      } else if (event.type === "message_stop") {
        // Emit all accumulated tool calls after the full stream — never emit early.
        if (pendingTools.size > 0) {
          yield { type: "tool_calls", calls: [...pendingTools.values()] };
        }
        yield { type: "done", stopReason };
      }
    }
  }
}
