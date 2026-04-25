import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "../../src/utils/prompt.js";
import type { ToolDefinition } from "../../src/tools/types.js";

/**
 * Tests for buildSystemPrompt() — verifies the system prompt is built correctly
 * and that learnings injection works properly.
 */

const stubTools: ToolDefinition[] = [
  {
    name: "file-read",
    description: "Read a file",
    parameters: {} as never,
    execute: async () => ({ success: true, output: "" }),
  },
];

describe("buildSystemPrompt()", () => {
  it("builds a base system prompt without learnings", () => {
    const prompt = buildSystemPrompt(stubTools);
    expect(prompt).toContain("Phase2S");
    expect(prompt).toContain("file-read");
    expect(prompt).not.toContain("Project memory");
    expect(prompt).not.toContain("learnings");
  });

  it("injects custom prompt when provided as second arg", () => {
    const prompt = buildSystemPrompt(stubTools, "Be terse.");
    expect(prompt).toContain("Be terse.");
    expect(prompt).toContain("file-read");
  });

  it("does not inject learnings into the system prompt (Sprint 73: learnings moved to per-turn context messages)", () => {
    // Learnings are now injected via Conversation.upsertLearningsMessage() before each turn,
    // not baked into the system prompt. buildSystemPrompt() accepts only tools + customPrompt.
    const prompt = buildSystemPrompt(stubTools, "Be terse.");
    expect(prompt).not.toContain("Project memory");
    expect(prompt).not.toContain("PHASE2S_LEARNINGS");
  });
});
