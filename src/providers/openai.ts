import OpenAI from "openai";
import type { Config } from "../core/config.js";
import type { Provider, Message, ToolCall } from "./types.js";
import type { OpenAIFunctionDef } from "../tools/types.js";

/**
 * Direct OpenAI API provider.
 *
 * Calls the OpenAI Chat Completions API directly using the user's API key.
 * This gives us full control over tool calling and the agent loop.
 */
export class OpenAIProvider implements Provider {
  name = "openai-api";
  private client: OpenAI;
  private model: string;

  constructor(config: Config) {
    if (!config.apiKey) {
      throw new Error(
        "OpenAI API key is required for the openai-api provider. " +
          "Set OPENAI_API_KEY environment variable or apiKey in .phase2s.yaml",
      );
    }
    this.client = new OpenAI({ apiKey: config.apiKey });
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

    const text = choice.message.content ?? "";
    const toolCalls: ToolCall[] = (choice.message.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: tc.function.arguments,
    }));

    return { text, toolCalls };
  }
}
