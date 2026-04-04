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

    const systemPrompt = buildSystemPrompt(
      this.tools.list(),
      opts.systemPrompt ?? opts.config.systemPrompt,
    );
    this.conversation = new Conversation(systemPrompt);

    log.dim(`Provider: ${this.provider.name} | Model: ${this.config.model}`);
  }

  /**
   * Run one turn of the agent loop:
   * user message -> LLM -> (tool calls -> execute -> LLM)* -> final text
   */
  async run(userMessage: string): Promise<string> {
    this.conversation.addUser(userMessage);

    let turns = 0;

    while (turns < this.maxTurns) {
      turns++;

      // Trim context before each LLM call to prevent context_length_exceeded errors
      this.conversation.trimToTokenBudget();

      const { text, toolCalls } = await this.provider.chat(
        this.conversation.getMessages(),
        this.tools.toOpenAI(),
      );

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
