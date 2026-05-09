import { exec } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import type { Config } from "./config.js";
import { Conversation } from "./conversation.js";
import { createProvider, type Provider } from "../providers/index.js";
import { createDefaultRegistry, type ToolRegistry, type RegistryOptions } from "../tools/index.js";
import { buildSystemPrompt, TASK_MODE_PREAMBLE } from "../utils/prompt.js";
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
  /**
   * When true, injects the task-mode preamble into the system prompt for this run
   * and enables doom-loop detection and auto-verify injection.
   * Use for `phase2s task` command. Has NO effect on subsequent REPL calls —
   * taskMode is passed as a runOnce() parameter, not stored as an instance field.
   */
  taskMode?: boolean;
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
  /** Pre-formatted learnings string from formatLearningsForPrompt(). Injected as a [PHASE2S_LEARNINGS] context message before each LLM turn via upsertLearningsMessage(). */
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
  /**
   * Code context string for the current REPL turn.
   * Three-state:
   *   undefined = never set — runOnce() skips upsertCodeContextMessage() entirely
   *   null      = cleared — runOnce() removes any existing CODE_CONTEXT marker
   *   string    = inject — runOnce() inserts/replaces the CODE_CONTEXT message
   *
   * Set via refreshCodeContext() by the CLI before each agent.run() call.
   */
  private codeContext: string | null | undefined = undefined;

  constructor(opts: AgentOptions) {
    this.config = opts.config;
    this.cwd = opts.cwd ?? process.cwd();
    this.learnings = opts.learnings;
    this.agentsMdBlock = opts.agentsMdBlock;
    const baseRegistry = opts.tools ?? createDefaultRegistry({
      allowDestructive: opts.config.allowDestructive,
      cwd: this.cwd,
      browserEnabled: opts.config.browser,
      ollamaBaseUrl: opts.config.ollamaBaseUrl,
      ollamaEmbedModel: opts.config.ollamaEmbedModel,
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
   * Update the stored code context block.
   * Called by the CLI before each agent.run() call.
   *   block = string  → inject [PHASE2S_CODE_CONTEXT] before the next LLM turn
   *   block = null    → clear any existing [PHASE2S_CODE_CONTEXT] marker
   * Once set (to string or null), runOnce() will always call upsertCodeContextMessage().
   */
  refreshCodeContext(block: string | null): void {
    this.codeContext = block;
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
      ollamaBaseUrl: this.config.ollamaBaseUrl,
      ollamaEmbedModel: this.config.ollamaEmbedModel,
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
        cwd: this.cwd,
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
    /**
     * When true, prepends the task-mode preamble to the system prompt for this call only.
     * Passed as a parameter (not an instance field) so a shared Agent used in the REPL
     * is unaffected — task-mode never bleeds between calls.
     */
    taskMode?: boolean;
    /**
     * Shell command to run after any file_write success in a turn.
     * Injected as a user message (not a synthetic tool result) for OpenAI protocol compat.
     * Passed as a parameter (not an instance field) for the same contamination reason.
     */
    verifyCommand?: string;
    /**
     * Injectable verify function (for testing). When provided, used instead of execAsync.
     */
    verifyFn?: (cmd: string) => Promise<{ exitCode: number; output: string }>;
  } = {}): Promise<string> {
    const { onDelta, modelOverride, signal, toolReflectionEnabled = true, taskMode, verifyCommand, verifyFn } = opts;
    const reflectionEnabled =
      toolReflectionEnabled &&
      process.env.PHASE2S_TOOL_ERROR_REFLECTION !== "off";

    // Doom-loop detection: track (tool_name + sha256(args)) fingerprints for this run.
    // Scoped to this runOnce() invocation — cleared on every new run() call.
    // "total count" semantics: 3 identical calls in any order within the run triggers exit.
    const recentCalls = new Map<string, number>();

    let turns = 0;

    // When taskMode is true, temporarily replace the system message with a task-mode version.
    // We swap it back at the end so REPL sessions sharing this Agent see no change.
    let savedSystemContent: string | null = null;
    if (taskMode) {
      const msgs = this.conversation.getMessages();
      const systemMsg = msgs.find((m) => m.role === "system");
      if (systemMsg && typeof systemMsg.content === "string") {
        savedSystemContent = systemMsg.content;
        // Rebuild with task-mode preamble by prepending it to the existing system message
        // (same content as buildSystemPrompt(tools, customPrompt, true) would produce).
        systemMsg.content = `${TASK_MODE_PREAMBLE}\n\n${savedSystemContent}`;
      }
    }

    try {
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

        // Inject (or clear) the [PHASE2S_CODE_CONTEXT] message when codeContext has been set.
        // Placed after LEARNINGS so the final conversation order is:
        //   [LEARNINGS] [CODE_CONTEXT] [USER]
        // Skipped entirely when codeContext is undefined (code-rag not configured this session).
        if (this.codeContext !== undefined) {
          this.conversation.upsertCodeContextMessage(
            this.codeContext !== null
              ? `${Conversation.CODE_CONTEXT_MARKER}\n${this.codeContext}`
              : null,
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
        let wroteFileThisTurn = false;

        // doomLoopReflect: set when a repeated call (fpCount==2) is detected.
        // Injected as a user message AFTER all tool results for this turn are committed,
        // keeping the OpenAI message protocol valid (no user message mid-tool-result batch).
        let doomLoopReflect = false;

        for (let _dli = 0; _dli < toolCalls.length; _dli++) {
          const call = toolCalls[_dli];
          log.tool(call.name, truncate(call.arguments, 100));

          // Doom-loop fingerprinting: sha256(args)[0..7] + tool name.
          // On 2nd identical call: flag for post-loop reflection injection.
          // On 3rd+ identical call: fill tool results for this call AND all remaining
          // calls in the batch before returning — this keeps the conversation in a
          // valid state (every tool_call_id declared by the assistant needs a result).
          const fp = `${call.name}:${createHash("sha256").update(call.arguments).digest("hex").slice(0, 8)}`;
          const fpCount = (recentCalls.get(fp) ?? 0) + 1;
          recentCalls.set(fp, fpCount);
          if (fpCount === 2) {
            doomLoopReflect = true; // deferred — injected after the tool-result batch
          } else if (fpCount >= 3) {
            // Emit placeholder tool results for this call and any unprocessed remaining
            // calls so the conversation stays protocol-compliant before early return.
            for (let _dlj = _dli; _dlj < toolCalls.length; _dlj++) {
              this.conversation.addToolResult(
                toolCalls[_dlj].id,
                "(Stopped: agent stuck in repeated tool call loop)",
              );
            }
            return "(Agent appears stuck — same tool call repeated 3+ times. Stopping.)";
          }

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
              // Track file_write successes for auto-verify cooldown.
              // Only writes that actually succeed count — failed writes don't warrant verification.
              if (call.name === "file_write") {
                wroteFileThisTurn = true;
              }
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

        // Doom-loop reflection: injected AFTER all tool results are committed so the
        // OpenAI message protocol is satisfied (no user message mid-tool-result batch).
        if (doomLoopReflect) {
          this.conversation.addUser("⚠️ You already tried this exact call. Try a different approach.");
        }

        // Auto-verify: fires once per tool-processing turn that contains at least one
        // file_write success. Injected as a user message (NOT a synthetic tool result —
        // the OpenAI tool protocol requires tool results to match declared tool_call_ids).
        if (wroteFileThisTurn && verifyCommand) {
          const { exitCode, output } = await this.runVerify(verifyCommand, verifyFn);
          const verifyStatus = exitCode === 0 ? "PASSED" : "FAILED";
          this.conversation.addUser(
            `[Auto-verify result] ${verifyStatus} (exit ${exitCode})\n${output.slice(0, 2000)}`,
          );
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
    } finally {
      // Restore the original system message so REPL sessions using this shared Agent
      // instance see no change after a task-mode run completes.
      if (savedSystemContent !== null) {
        const msgs = this.conversation.getMessages();
        const systemMsg = msgs.find((m) => m.role === "system");
        if (systemMsg) {
          systemMsg.content = savedSystemContent;
        }
      }
    }
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
          taskMode: opts.taskMode,
          // In satori mode, verifyCommand is used for the retry-loop verification.
          // Don't also pass it to runOnce auto-verify to avoid double-verification.
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

    // Normal single-pass mode (also handles task mode — verifyCommand passed for auto-verify)
    return this.runOnce({
      onDelta: opts.onDelta,
      modelOverride: opts.modelOverride,
      signal: opts.signal,
      taskMode: opts.taskMode,
      verifyCommand: opts.verifyCommand ?? this.config.verifyCommand,
      verifyFn: opts.verifyFn,
    });
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "...";
}
