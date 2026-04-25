import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { Config } from "./config.js";
import { Conversation } from "./conversation.js";
import { createProvider, type Provider } from "../providers/index.js";
import { createDefaultRegistry, type ToolRegistry, type RegistryOptions } from "../tools/index.js";
import { buildSystemPrompt } from "../utils/prompt.js";
import { log } from "../utils/logger.js";
import { buildRegistryForAgent, type AgentDef } from "./agent-loader.js";
import { RateLimitError } from "./rate-limit-error.js";

const execAsync = promisify(exec);

export interface SatoriResult {
  attempt: number;
  passed: boolean;
  verifyOutput: string;
  text: string;
}

export interface AgentRunOptions {
  onDelta?: (text: string) => void;
  modelOverride?: string;
  /** AbortSignal for cooperative cancellation (e.g. from SIGINT handler).
   * When aborted, the current chatStream call is cancelled and run() returns
   * without completing the full conversation. */
  signal?: AbortSignal;
  // Satori options:
  maxRetries?: number;
  verifyCommand?: string;
  verifyFn?: (command: string) => Promise<{ exitCode: number; output: string }>;
  preRun?: () => Promise<void>;
  postRun?: (result: SatoriResult) => Promise<void>;
}

/**
 * Tool error reflection fragment — injected into the conversation when a tool
 * call fails, before the next LLM turn. Mirrors the doom-loop 3-question structure
 * for consistency. Controlled via PHASE2S_TOOL_ERROR_REFLECTION=off.
 */
const TOOL_ERROR_REFLECTION_FRAGMENT = `\n## Tool failure reflection
Before retrying, answer these three questions:
1. What specifically failed? (name the tool, the input, the error message)
2. Why did your approach cause this failure?
3. What are you doing DIFFERENTLY in your next attempt — not just the same call with slightly different parameters?

If you cannot identify a meaningfully different approach, do NOT retry. Explain the blocker instead.`;

export interface AgentOptions {
  config: Config;
  tools?: ToolRegistry;
  systemPrompt?: string;
  /**
   * Pre-formatted AGENTS.md block (from formatAgentsMdBlock()).
   * Injected into the system prompt at construction and preserved across
   * switchAgentDef() calls so project/user-global conventions survive
   * persona switches.
   */
  agentsMdBlock?: string;
  provider?: Provider;
  conversation?: Conversation;
  /** Pre-formatted learnings string from formatLearningsForPrompt(). Injected into the system prompt. */
  learnings?: string;
  /** Working directory for tools that need it (e.g. browser tool screenshot path). Default: process.cwd(). */
  cwd?: string;
}

export class Agent {
  private _provider: Provider;
  private tools: ToolRegistry;
  private conversation: Conversation;
  private config: Config;
  private maxTurns: number;
  private cwd: string;
  private learnings: string | undefined;
  /**
   * Pre-formatted AGENTS.md block (from formatAgentsMdBlock()).
   * Tracked separately from config.systemPrompt so it can be re-injected on
   * switchAgentDef() without carrying over the previous persona's instructions.
   */
  private agentsMdBlock: string | undefined;

  constructor(opts: AgentOptions) {
    this.config = opts.config;
    this.cwd = opts.cwd ?? process.cwd();
    this.learnings = opts.learnings;
    this.agentsMdBlock = opts.agentsMdBlock;
    const baseRegistry = opts.tools ?? createDefaultRegistry({
      allowDestructive: opts.config.allowDestructive,
      cwd: this.cwd,
      browserEnabled: opts.config.browser,
    });
    // Apply per-project allow/deny list from config (deny overrides allow)
    this.tools = baseRegistry.allowed(opts.config.tools, opts.config.deny);
    this._provider = opts.provider ?? createProvider(opts.config);
    this.maxTurns = opts.config.maxTurns;

    // Combine config-level systemPrompt with AGENTS.md block so both are injected.
    const baseCustomPrompt = opts.systemPrompt ?? opts.config.systemPrompt;
    const customPrompt =
      [baseCustomPrompt, this.agentsMdBlock].filter(Boolean).join("\n\n") || undefined;

    // Always build the system prompt so it reflects the current tool list and config.
    // Learnings are NOT baked into the system prompt — they are injected as a rolling
    // [PHASE2S_LEARNINGS] context message before each turn via upsertLearningsMessage().
    const systemPrompt = buildSystemPrompt(this.tools.list(), customPrompt);
    this.conversation = new Conversation(systemPrompt);
    if (opts.conversation) {
      this.setConversation(opts.conversation);
    }

    log.dim(`Provider: ${this._provider.name} | Model: ${this.config.model}`);
  }

  getConversation(): Conversation {
    return this.conversation;
  }

  /** Expose the active provider for compaction and other callers. */
  get provider(): Provider {
    return this._provider;
  }

  /**
   * Update the stored learnings string.
   * Called by the REPL before each agent.run() call so the [PHASE2S_LEARNINGS]
   * context message stays topic-relevant. runOnce() picks up the new value on
   * its next call to upsertLearningsMessage().
   */
  refreshLearnings(newStr: string): void {
    this.learnings = newStr;
  }


  /**
   * Replace the agent's active conversation with messages from a loaded session,
   * preserving the agent's current system prompt.
   *
   * The loaded session's messages may contain a system prompt from a different run
   * (different tools, different config). Keeping it would corrupt the current agent's
   * tool list and behavior. Instead, strip any system messages from the incoming
   * conversation and prepend this agent's own system message.
   *
   * Used by :clone to switch the agent to the forked session without reinitializing.
   */
  setConversation(conv: Conversation): void {
    const currentMessages = this.conversation.getMessages();
    const systemMsg = currentMessages.find((m) => m.role === "system");
    const nonSystemMessages = conv.getMessages().filter((m) => m.role !== "system");
    // Shallow-copy systemMsg to avoid aliasing: the merged array and the caller's
    // getMessages() copy would otherwise share the same Message object reference.
    const merged = systemMsg ? [{ ...systemMsg }, ...nonSystemMessages] : nonSystemMessages;
    this.conversation = Conversation.fromMessages(merged);
  }

  /**
   * Switch the active agent persona in-place.
   *
   * Updates the tool registry and rebuilds the system prompt from the new AgentDef.
   * Conversation history is preserved — only the system message is replaced.
   * This is used by REPL commands like :apollo, :athena, :ares to switch agents
   * mid-session without losing context.
   *
   * Model overrides from the AgentDef are applied per-request via resolveModel(),
   * so no provider reconstruction is needed.
   */
  switchAgentDef(def: AgentDef): void {
    const registryOpts: RegistryOptions = {
      allowDestructive: this.config.allowDestructive,
      cwd: this.cwd,
      browserEnabled: this.config.browser,
    };
    const builtRegistry = buildRegistryForAgent(def, registryOpts);
    // Re-apply project config allow/deny list so switchAgentDef cannot bypass
    // restrictions that were applied in the constructor.
    this.tools = builtRegistry.allowed(this.config.tools, this.config.deny);

    // Combine the agent def's own persona prompt with the AGENTS.md block so
    // project/user-global conventions survive persona switches.
    // config.systemPrompt is intentionally NOT carried over — the new persona replaces it.
    const combinedCustomPrompt =
      [def.systemPrompt, this.agentsMdBlock].filter(Boolean).join("\n\n") || undefined;
    const newSystemPrompt = buildSystemPrompt(this.tools.list(), combinedCustomPrompt);
    const msgs = this.conversation.getMessages();
    const nonSystemMessages = msgs.filter((m) => m.role !== "system");
    this.conversation = Conversation.fromMessages([
      { role: "system", content: newSystemPrompt },
      ...nonSystemMessages,
    ]);

    log.dim(`Switched to agent: ${def.id} [${def.model}, ${def.tools === undefined ? "all tools" : `${def.tools.length} tools`}]`);
  }

  /**
   * Resolve a model alias ("fast" | "smart") to an actual model ID using config.
   * Falls back to config.model if alias not configured.
   */
  private resolveModel(model: string): string {
    if (model === "fast") return this.config.fast_model ?? this.config.model;
    if (model === "smart") return this.config.smart_model ?? this.config.model;
    return model; // literal model string
  }

  /**
   * Run the shell verify command. Uses verifyFn if provided (for testing),
   * otherwise execs the command directly.
   */
  private async runVerify(
    command: string,
    verifyFn?: (cmd: string) => Promise<{ exitCode: number; output: string }>,
  ): Promise<{ exitCode: number; output: string }> {
    if (verifyFn) return verifyFn(command);
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: process.cwd(),
        timeout: 120_000,
      });
      return { exitCode: 0, output: stdout + stderr };
    } catch (err: unknown) {
      const e = err as { code?: number; stdout?: string; stderr?: string };
      return {
        exitCode: e.code ?? 1,
        output: (e.stdout ?? "") + (e.stderr ?? ""),
      };
    }
  }

  /**
   * Run one pass of the agent loop (inner loop — does NOT add userMessage to conversation).
   * Called by run() after the user message is already added.
   */
  private async runOnce(opts: {
    onDelta?: (text: string) => void;
    modelOverride?: string;
    signal?: AbortSignal;
    /** When true, injects a reflection fragment after a tool failure before the next LLM turn.
     *  Set to false for satori attempts 2+ (doom-loop context already provides the directive). */
    toolReflectionEnabled?: boolean;
  } = {}): Promise<string> {
    const { onDelta, modelOverride, signal, toolReflectionEnabled = true } = opts;
    const reflectionEnabled =
      toolReflectionEnabled &&
      process.env.PHASE2S_TOOL_ERROR_REFLECTION !== "off";

    let turns = 0;

    while (turns < this.maxTurns) {
      turns++;

      // Inject (or refresh) the [PHASE2S_LEARNINGS] context message before trimming.
      // This ensures the message is present for the current turn even after compaction
      // rewrites the conversation. Placed before trimToTokenBudget so it is counted in
      // the token estimate — but it won't be trimmed (trimToTokenBudget only removes tool turns).
      if (this.learnings) {
        this.conversation.upsertLearningsMessage(
          `${Conversation.LEARNINGS_MARKER}\n${this.learnings}`,
        );
      }

      this.conversation.trimToTokenBudget();

      let text = "";
      const toolCalls: import("../providers/types.js").ToolCall[] = [];

      const resolvedModel = modelOverride ? this.resolveModel(modelOverride) : undefined;

      for await (const event of this._provider.chatStream(
        this.conversation.getMessages(),
        this.tools.toOpenAI(),
        (resolvedModel || signal) ? { model: resolvedModel, signal } : undefined,
      )) {
        if (event.type === "text") {
          text += event.content;
          onDelta?.(event.content);
        } else if (event.type === "tool_calls") {
          toolCalls.push(...event.calls);
        } else if (event.type === "error") {
          throw new Error(event.error);
        } else if (event.type === "rate_limited") {
          // Rate limit — not a failure. Throw typed error so REPL/goal can checkpoint.
          // Must NOT be caught by the satori retry loop — propagates to CLI layer.
          throw new RateLimitError(event.retryAfter, this._provider.name);
        } else if (event.type === "done") {
          break;
        }
      }

      if (toolCalls.length === 0) {
        this.conversation.addAssistant(text);
        return text;
      }

      this.conversation.addAssistant(text, toolCalls);

      let hadToolError = false;
      for (const call of toolCalls) {
        log.tool(call.name, truncate(call.arguments, 100));

        let args: unknown;
        try {
          args = JSON.parse(call.arguments);
        } catch {
          this.conversation.addToolResult(call.id, `Error: Invalid JSON arguments`);
          hadToolError = true;
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
            hadToolError = true;
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          log.tool(call.name, `Unexpected error: ${msg}`);
          resultContent = `Error: ${msg}`;
          hadToolError = true;
        }
        this.conversation.addToolResult(call.id, resultContent);
      }

      // Inject tool error reflection after all tool results are added, once per turn.
      // This gives the LLM explicit reflection directives before its next response.
      if (hadToolError && reflectionEnabled) {
        this.conversation.addUser(TOOL_ERROR_REFLECTION_FRAGMENT);
      }

      // Inject a newline between tool-call turns so streamed output reads as
      // separate paragraphs rather than concatenated strings. Only fires when
      // the current turn produced visible text — silent tool calls (no text)
      // get no separator, avoiding spurious blank lines.
      if (text.length > 0) {
        onDelta?.("\n");
      }
    }

    return "(Agent reached maximum turns without a final response)";
  }

  /**
   * Run the agent with an optional satori retry loop.
   *
   * If options.maxRetries is set, runs the task, verifies with verifyCommand,
   * retries on failure (injecting failure context), stops when passing or exhausted.
   */
  async run(userMessage: string, options?: AgentRunOptions | ((text: string) => void)): Promise<string> {
    // Backward compat: if called as run(message, onDelta) (old signature), wrap in options
    const opts: AgentRunOptions = typeof options === "function"
      ? { onDelta: options }
      : (options ?? {});

    this.conversation.addUser(userMessage);

    // Satori mode: retry loop with shell verification
    if (opts.maxRetries && opts.maxRetries > 0) {
      const verifyCommand = opts.verifyCommand ?? this.config.verifyCommand ?? "npm test";

      if (opts.preRun) await opts.preRun();

      let lastText = "";
      for (let attempt = 1; attempt <= opts.maxRetries; attempt++) {
        // Cooperative cancellation: check before each retry attempt.
        if (opts.signal?.aborted) break;

        // Tool reflection only on attempt 1 — attempts 2+ already have doom-loop context.
        lastText = await this.runOnce({
          onDelta: opts.onDelta,
          modelOverride: opts.modelOverride,
          signal: opts.signal,
          toolReflectionEnabled: attempt === 1,
        });

        // Check again after the (potentially long) runOnce completes.
        if (opts.signal?.aborted) break;

        const { exitCode, output } = await this.runVerify(verifyCommand, opts.verifyFn);
        const passed = exitCode === 0;

        const satoriResult: SatoriResult = {
          attempt,
          passed,
          verifyOutput: output,
          text: lastText,
        };

        if (opts.postRun) await opts.postRun(satoriResult);

        if (passed) {
          return lastText;
        }

        if (attempt < opts.maxRetries) {
          // Inject failure context for next attempt
          this.conversation.addUser(
            `Verification failed on attempt ${attempt}/${opts.maxRetries}:\n${output.slice(0, 2000)}\nPlease address these failures.`,
          );
        }
      }

      return `${lastText}\n\n[Satori: verification did not pass after ${opts.maxRetries} attempts]`;
    }

    // Normal single-pass mode
    return this.runOnce({ onDelta: opts.onDelta, modelOverride: opts.modelOverride, signal: opts.signal });
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "...";
}
