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

  it("injects learnings block when learnings string is provided", () => {
    const learningsBlock = [
      "## Project memory",
      "The following learnings from previous sessions apply to this project:",
      "- [use-vitest]: This project uses vitest not jest",
      "(1 learning loaded from .phase2s/memory/learnings.jsonl)",
    ].join("\n");

    const prompt = buildSystemPrompt(stubTools, undefined, learningsBlock);
    expect(prompt).toContain("## Project memory");
    expect(prompt).toContain("use-vitest");
    expect(prompt).toContain("This project uses vitest not jest");
  });

  it("backward compatible: works without learnings param (existing callers unaffected)", () => {
    // Calling with just tools + custom prompt should work exactly as before
    const prompt = buildSystemPrompt(stubTools, "Be terse.");
    expect(prompt).toContain("Be terse.");
    expect(prompt).toContain("file-read");
    expect(prompt).not.toContain("Project memory");
  });
});
