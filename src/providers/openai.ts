import OpenAI from "openai";
import type { ChatCompletionChunk } from "openai/resources/chat/completions.js";
import type { Config } from "../core/config.js";
import type { Provider, Message, ToolCall, ProviderEvent } from "./types.js";
import type { OpenAIFunctionDef } from "../tools/types.js";
import { log } from "../utils/logger.js";

/**
 * Structural interface for the OpenAI client's streaming chat.completions.create.
 * Exported so tests can inject a typed stub without importing the full OpenAI SDK class.
 * We only use the streaming overload (stream: true) — non-streaming is no longer needed.
 */
export interface OpenAIClientLike {
  chat: {
    completions: {
      create(params: {
        model: string;
        messages: unknown[];
        tools?: unknown[];
        stream: true;
        signal?: AbortSignal;
      }): Promise<AsyncIterable<ChatCompletionChunk>>;
    };
  };
}

/**
 * Direct OpenAI API provider.
 *
 * Streams responses via chat completions with stream: true.
 * Tool call fragments are accumulated per-index across chunks and emitted
 * as a single tool_calls event after the stream ends.
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

  async *chatStream(
    messages: Message[],
    tools: OpenAIFunctionDef[],
    options?: import("./types.js").ChatStreamOptions,
  ): AsyncIterable<ProviderEvent> {
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

    const stream = await this.client.chat.completions.create({
      model: options?.model ?? this.model,
      messages: openaiMessages,
      tools: tools.length > 0 ? tools : undefined,
      stream: true,
      signal: options?.signal,
    });

    let lastFinishReason: string | null = null;
    // Per-index accumulator for streaming tool call argument fragments.
    // OpenAI sends tool call data split across multiple chunks, indexed by position.
    const toolCallAccum: Array<{ id: string; name: string; arguments: string }> = [];

    try {
      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (!choice) continue;

        const delta = choice.delta;
        const finishReason = choice.finish_reason ?? null;
        if (finishReason) lastFinishReason = finishReason;

        // Early-exit for terminal finish reasons that block normal output.
        // These come on the final chunk which has no content delta.
        if (finishReason === "length") {
          log.warn("Response truncated (finish_reason: length). Consider a shorter prompt.");
          yield { type: "text", content: "\n\n[Note: response was truncated]" };
          yield { type: "done", stopReason: "length" };
          return;
        }
        if (finishReason === "content_filter") {
          log.warn("Response blocked by OpenAI content filter (finish_reason: content_filter).");
          yield { type: "text", content: "[Response blocked by content filter]" };
          yield { type: "done", stopReason: "content_filter" };
          return;
        }

        // Yield text delta if present
        if (delta?.content) {
          yield { type: "text", content: delta.content };
        }

        // Accumulate tool call fragments by chunk index.
        // - The 'id' and 'function.name' arrive only in the first chunk for each index.
        // - 'function.arguments' is split across multiple chunks and must be concatenated.
        for (const tcDelta of delta?.tool_calls ?? []) {
          const i = tcDelta.index;
          if (!toolCallAccum[i]) {
            toolCallAccum[i] = { id: "", name: "", arguments: "" };
          }
          if (tcDelta.id) toolCallAccum[i].id = tcDelta.id;
          if (tcDelta.function?.name) toolCallAccum[i].name = tcDelta.function.name;
          if (tcDelta.function?.arguments) toolCallAccum[i].arguments += tcDelta.function.arguments;
        }
      }
    } catch (err) {
      // If the stream was aborted by the caller (SIGINT), suppress the SDK error — it
      // is not a failure. The OpenAI SDK throws APIUserAbortError when the signal fires.
      if (options?.signal?.aborted) {
        yield { type: "done", stopReason: "stop" };
        return;
      }
      throw err;
    }

    // Filter out any sparse-array holes (undefined slots from non-contiguous indices).
    // Normally OpenAI sends tool call indices as 0, 1, 2... but guard against gaps.
    const validCalls = toolCallAccum.filter((tc) => tc !== undefined && tc.id !== "");
    if (validCalls.length > 0) {
      const calls: ToolCall[] = validCalls.map((tc) => ({
        id: tc.id,
        name: tc.name,
        arguments: tc.arguments, // raw JSON string — parsed by tool executor
      }));
      yield { type: "tool_calls", calls };
    }

    yield { type: "done", stopReason: lastFinishReason ?? "stop" };
  }
}
