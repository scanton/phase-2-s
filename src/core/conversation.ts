import type { Message } from "../providers/types.js";

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

  /** Rough token estimate for context management */
  estimateTokens(): number {
    return this.messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);
  }
}
