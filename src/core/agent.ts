import type { Config } from "./config.js";
import { Conversation } from "./conversation.js";
import { createProvider, type Provider } from "../providers/index.js";
import { createDefaultRegistry, type ToolRegistry } from "../tools/index.js";
import { buildSystemPrompt } from "../utils/prompt.js";
import { log } from "../utils/logger.js";

export interface AgentOptions {
  config: Config;
  tools?: ToolRegistry;
  systemPrompt?: string;
  provider?: Provider;
  /** Inject an existing conversation (e.g. loaded from a saved session via --resume). */
  conversation?: Conversation;
}

export class Agent {
  private provider: Provider;
  private tools: ToolRegistry;
  private conversation: Conversation;
  private config: Config;
  private maxTurns: number;

  constructor(opts: AgentOptions) {
    this.config = opts.config;
    this.tools = opts.tools ?? createDefaultRegistry(opts.config.allowDestructive);
    this.provider = opts.provider ?? createProvider(opts.config);
    this.maxTurns = opts.config.maxTurns;

    if (opts.conversation) {
      // Resume from an injected conversation (loaded from a saved session).
      this.conversation = opts.conversation;
    } else {
      const systemPrompt = buildSystemPrompt(
        this.tools.list(),
        opts.systemPrompt ?? opts.config.systemPrompt,
      );
      this.conversation = new Conversation(systemPrompt);
    }

    log.dim(`Provider: ${this.provider.name} | Model: ${this.config.model}`);
  }

  /**
   * Expose the current conversation for external save/inspect (e.g. session persistence).
   */
  getConversation(): Conversation {
    return this.conversation;
  }

  /**
   * Run one turn of the agent loop:
   * user message -> LLM stream -> (tool calls -> execute -> LLM stream)* -> final text
   *
   * @param userMessage - The user's input
   * @param onDelta - Optional callback invoked with each text chunk as it arrives.
   *   Fires on every text event across all turns (including intermediate tool-call
   *   reasoning text if the LLM produces any). Skills call run() without onDelta
   *   (batch semantics); the CLI uses onDelta to stream to stdout.
   */
  async run(userMessage: string, onDelta?: (text: string) => void): Promise<string> {
    this.conversation.addUser(userMessage);

    let turns = 0;

    while (turns < this.maxTurns) {
      turns++;

      // Trim context before each LLM call to prevent context_length_exceeded errors
      this.conversation.trimToTokenBudget();

      let text = "";
      const toolCalls: import("../providers/types.js").ToolCall[] = [];

      for await (const event of this.provider.chatStream(
        this.conversation.getMessages(),
        this.tools.toOpenAI(),
      )) {
        if (event.type === "text") {
          text += event.content;
          onDelta?.(event.content);
        } else if (event.type === "tool_calls") {
          toolCalls.push(...event.calls);
        } else if (event.type === "error") {
          throw new Error(event.error);
        } else if (event.type === "done") {
          break;
        }
      }

      if (toolCalls.length === 0) {
        // No tool calls — final response
        this.conversation.addAssistant(text);
        return text;
      }

      // Record assistant message with tool calls
      this.conversation.addAssistant(text, toolCalls);

      // Execute each tool call
      for (const call of toolCalls) {
        log.tool(call.name, truncate(call.arguments, 100));

        let args: unknown;
        try {
          args = JSON.parse(call.arguments);
        } catch {
          this.conversation.addToolResult(call.id, `Error: Invalid JSON arguments`);
          continue;
        }

        let resultContent: string;
        try {
          const result = await this.tools.execute(call.name, args);
          if (result.success) {
            log.tool(call.name, truncate(result.output, 200));
            resultContent = result.output;
          } else {
            log.tool(call.name, `Error: ${result.error}`);
            resultContent = `Error: ${result.error}`;
          }
        } catch (err: unknown) {
          // Catch unexpected throws so the assistant message's tool_calls are always
          // paired with a tool result — otherwise the OpenAI API returns a 400.
          const msg = err instanceof Error ? err.message : String(err);
          log.tool(call.name, `Unexpected error: ${msg}`);
          resultContent = `Error: ${msg}`;
        }
        this.conversation.addToolResult(call.id, resultContent);
      }
    }

    return "(Agent reached maximum turns without a final response)";
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "...";
}
