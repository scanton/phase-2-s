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

  /** Rough token estimate for context management (4 chars ≈ 1 token). */
  estimateTokens(): number {
    return this.messages.reduce((sum, m) => sum + Math.ceil((m.content ?? "").length / 4), 0);
  }

  /**
   * Trim oldest tool result messages to stay under the token budget.
   * Called automatically before each LLM turn to prevent context overflow.
   *
   * Preserves: system prompt, user messages, assistant messages.
   * Drops: tool results (oldest first) — they're the noisiest and most redundant.
   */
  trimToTokenBudget(maxTokens: number = DEFAULT_TOKEN_BUDGET): void {
    while (this.estimateTokens() > maxTokens) {
      const idx = this.messages.findIndex((m) => m.role === "tool");
      if (idx === -1) break; // nothing left to trim
      this.messages.splice(idx, 1);
    }
  }
}
