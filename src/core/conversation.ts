import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Message } from "../providers/types.js";

// Conservative token budget: 80% of gpt-4o's 128k context window.
// Trimming starts here to leave headroom for the model's response.
const DEFAULT_TOKEN_BUDGET = Math.floor(128_000 * 0.8);

export class Conversation {
  private messages: Message[] = [];

  constructor(systemPrompt?: string) {
    if (systemPrompt) {
      this.messages.push({ role: "system", content: systemPrompt });
    }
  }

  addUser(content: string): void {
    this.messages.push({ role: "user", content });
  }

  addAssistant(content: string, toolCalls?: Message["toolCalls"]): void {
    this.messages.push({ role: "assistant", content, toolCalls });
  }

  addToolResult(toolCallId: string, content: string): void {
    this.messages.push({ role: "tool", content, toolCallId });
  }

  getMessages(): Message[] {
    return [...this.messages];
  }

  /**
   * Prefix used to identify the per-turn learnings context message.
   * Searched by content prefix so compaction (which rewrites the messages array)
   * does not invalidate the lookup.
   */
  static readonly LEARNINGS_MARKER = "[PHASE2S_LEARNINGS]";

  /**
   * Insert or replace the [PHASE2S_LEARNINGS] context message.
   *
   * Always places the message immediately before the last user message (the
   * current pending turn). This ensures Anthropic's translateMessages() sees
   * LEARNINGS + current-user-turn as consecutive user messages that get merged,
   * rather than LEARNINGS + a historical user message from earlier in the
   * conversation.
   *
   * Strategy:
   *   1. Remove any existing LEARNINGS message (splice, not replace-in-place —
   *      in-place replacement would keep LEARNINGS at its old position, which
   *      may be before a historical turn rather than the current one).
   *   2. Scan backward for the last `role === "user"` message and insert before it.
   *   3. If no user messages exist yet, append (will be positioned correctly when
   *      the actual user turn is added by addUser()).
   */
  upsertLearningsMessage(content: string): void {
    const MARKER = Conversation.LEARNINGS_MARKER;
    const msg: Message = { role: "user", content };

    // Step 1: remove existing LEARNINGS message if present
    const idx = this.messages.findIndex(
      (m) => m.role === "user" && (m.content ?? "").startsWith(MARKER),
    );
    if (idx !== -1) {
      this.messages.splice(idx, 1);
    }

    // Step 2: insert just before the last user message (current pending turn)
    let insertAt = -1;
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === "user") {
        insertAt = i;
        break;
      }
    }
    if (insertAt === -1) {
      this.messages.push(msg);
    } else {
      this.messages.splice(insertAt, 0, msg);
    }
  }

  get length(): number {
    return this.messages.length;
  }

  /** Rough token estimate for context management (4 chars ≈ 1 token).
   * Includes toolCalls arguments in the estimate — they can be substantial
   * and excluding them causes consistent undercounting that leads to 400 errors. */
  estimateTokens(): number {
    return this.messages.reduce((sum, m) => {
      const contentLen = (m.content ?? "").length;
      const toolCallsLen = m.toolCalls
        ? m.toolCalls.reduce((s, tc) => s + tc.name.length + tc.arguments.length, 0)
        : 0;
      return sum + Math.ceil((contentLen + toolCallsLen) / 4);
    }, 0);
  }

  /**
   * Serialize the conversation history to a JSON file.
   * Creates parent directories if they don't exist.
   *
   * @param mode  Optional file permission mode (e.g. 0o600 for owner-only).
   *              Defaults to umask-controlled permissions if not specified.
   *              Pass 0o600 from the CLI to prevent session files (which may
   *              contain code, file paths, or secrets) from being world-readable.
   */
  async save(path: string, mode?: number): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const content = JSON.stringify(this.messages, null, 2);
    if (mode !== undefined) {
      await writeFile(path, content, { encoding: "utf-8", mode });
    } else {
      await writeFile(path, content, "utf-8");
    }
  }

  /**
   * Create a Conversation directly from an array of messages.
   * No validation — caller is responsible for message integrity.
   * Used by Agent.setConversation() to splice in a loaded session's
   * messages while preserving the agent's current system prompt.
   */
  static fromMessages(messages: Message[]): Conversation {
    const conv = new Conversation();
    conv.messages = [...messages];
    return conv;
  }

  /**
   * Deserialize a conversation from a JSON file.
   *
   * Handles two session formats:
   *   v1 (legacy): bare JSON array of messages
   *   v2 (current): { schemaVersion: 2, meta: SessionMeta, messages: Message[] }
   *
   * Throws if the file doesn't exist, is unreadable, contains invalid JSON,
   * or has an unrecognized format.
   * Callers (e.g. the CLI --resume path) should handle these gracefully.
   */
  static async load(path: string): Promise<Conversation> {
    const raw = await readFile(path, "utf-8");
    const parsed: unknown = JSON.parse(raw);

    // v2 format: { schemaVersion: 2, meta, messages }
    let messagesArray: unknown[];
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      (parsed as Record<string, unknown>).schemaVersion === 2
    ) {
      const v2 = parsed as { messages: unknown };
      if (!Array.isArray(v2.messages)) {
        throw new Error("Invalid session file: v2 format missing messages array");
      }
      messagesArray = v2.messages;
    } else if (Array.isArray(parsed)) {
      // v1 legacy format
      messagesArray = parsed;
    } else {
      throw new Error("Invalid session file: unrecognized format (expected array or v2 object)");
    }
    // Validate each message to prevent prompt injection via a crafted session file.
    const validRoles = new Set(["system", "user", "assistant", "tool"]);
    for (let i = 0; i < messagesArray.length; i++) {
      const msg = messagesArray[i];
      if (typeof msg !== "object" || msg === null) {
        throw new Error(`Invalid session file: message at index ${i} is not an object`);
      }
      const { role, content } = msg as Record<string, unknown>;
      if (typeof role !== "string" || !validRoles.has(role)) {
        throw new Error(`Invalid session file: message at index ${i} has invalid role: ${String(role)}`);
      }
      if (content !== undefined && content !== null && typeof content !== "string") {
        throw new Error(`Invalid session file: message at index ${i} has non-string content`);
      }
    }
    const messages: Message[] = messagesArray as Message[];
    const conv = new Conversation();
    // Copy the array to avoid sharing the reference with the parsed JSON object.
    conv.messages = [...messages];
    return conv;
  }

  /**
   * Trim oldest tool turns to stay under the token budget.
   * Called automatically before each LLM turn to prevent context overflow.
   *
   * Drops complete turns atomically: the assistant message that issued tool calls
   * AND all its paired tool results are removed together. This is required because
   * the OpenAI API rejects messages where a tool result exists without its paired
   * assistant tool_call (or vice versa) — partial removal causes a 400 error.
   *
   * Preserves: system prompt, user messages, assistant text-only responses.
   */
  trimToTokenBudget(maxTokens: number = DEFAULT_TOKEN_BUDGET): void {
    while (this.estimateTokens() > maxTokens) {
      // Find the oldest tool result message
      const firstToolIdx = this.messages.findIndex((m) => m.role === "tool");
      if (firstToolIdx === -1) break; // nothing left to trim

      // The assistant message that issued these tool calls is immediately before
      // the first tool result in this batch
      const prevIdx = firstToolIdx - 1;
      const prevMsg = prevIdx >= 0 ? this.messages[prevIdx] : null;

      if (prevMsg?.role === "assistant" && prevMsg.toolCalls?.length) {
        // Drop the entire turn: assistant message + all its consecutive tool results
        let endIdx = firstToolIdx;
        while (endIdx < this.messages.length && this.messages[endIdx].role === "tool") {
          endIdx++;
        }
        this.messages.splice(prevIdx, endIdx - prevIdx);
      } else {
        // Orphaned tool result (no paired assistant message) — drop just the result
        this.messages.splice(firstToolIdx, 1);
      }
    }
  }
}
