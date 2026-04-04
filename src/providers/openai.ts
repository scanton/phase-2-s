import OpenAI from "openai";
import type { ChatCompletion, ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions.js";
import type { Config } from "../core/config.js";
import type { Provider, Message, ToolCall } from "./types.js";
import type { OpenAIFunctionDef } from "../tools/types.js";
import { log } from "../utils/logger.js";

/**
 * Structural interface for the OpenAI client's chat.completions.create method.
 * Exported so tests can import it and inject a typed stub without importing
 * the full OpenAI SDK class.
 */
export interface OpenAIClientLike {
  chat: {
    completions: {
      create(params: ChatCompletionCreateParamsNonStreaming): Promise<ChatCompletion>;
    };
  };
}

/**
 * Direct OpenAI API provider.
 *
 * Calls the OpenAI Chat Completions API directly using the user's API key.
 * This gives us full control over tool calling and the agent loop.
 */
export class OpenAIProvider implements Provider {
  name = "openai-api";
  private client: OpenAIClientLike;
  private model: string;

  constructor(config: Config, client?: OpenAIClientLike) {
    if (!client && !config.apiKey) {
      throw new Error(
        "OpenAI API key is required for the openai-api provider. " +
          "Set OPENAI_API_KEY environment variable or apiKey in .phase2s.yaml",
      );
    }
    // The real OpenAI class satisfies OpenAIClientLike structurally; one cast at construction.
    this.client = client ?? (new OpenAI({ apiKey: config.apiKey }) as unknown as OpenAIClientLike);
    this.model = config.model;
  }

  async chat(
    messages: Message[],
    tools: OpenAIFunctionDef[],
  ): Promise<{ text: string; toolCalls: ToolCall[] }> {
    const openaiMessages = messages.map((m) => {
      if (m.role === "tool") {
        return {
          role: "tool" as const,
          content: m.content,
          tool_call_id: m.toolCallId!,
        };
      }
      if (m.role === "assistant" && m.toolCalls?.length) {
        return {
          role: "assistant" as const,
          content: m.content || null,
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: {
              name: tc.name,
              arguments: tc.arguments,
            },
          })),
        };
      }
      return {
        role: m.role as "system" | "user" | "assistant",
        content: m.content,
      };
    });

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: openaiMessages,
      tools: tools.length > 0 ? tools : undefined,
    });

    const choice = response.choices[0];
    if (!choice) {
      throw new Error("No response from OpenAI");
    }

    const finishReason = choice.finish_reason;

    // "stop" and "tool_calls" are the normal cases — handled by toolCalls.length check below.
    // "null" can appear transiently; treat as "stop" (return whatever text/calls are present).
    if (finishReason === "length") {
      log.warn("Response truncated (finish_reason: length). Consider a shorter prompt.");
      return {
        text: (choice.message.content ?? "") + "\n\n[Note: response was truncated]",
        toolCalls: [],
      };
    }
    if (finishReason === "content_filter") {
      log.warn("Response blocked by OpenAI content filter (finish_reason: content_filter).");
      return { text: "[Response blocked by content filter]", toolCalls: [] };
    }
    // finishReason === "stop" | "tool_calls" | null: fall through to normal extraction

    const text = choice.message.content ?? "";
    const toolCalls: ToolCall[] = (choice.message.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: tc.function.arguments,
    }));

    return { text, toolCalls };
  }
}
