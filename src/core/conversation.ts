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
