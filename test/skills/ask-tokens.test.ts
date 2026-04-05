import { describe, it, expect } from "vitest";
import { extractAskTokens, substituteAskValues, stripAskTokens } from "../../src/skills/template.js";

describe("extractAskTokens", () => {
  it("returns empty array for a template with no {{ASK:}} tokens", () => {
    const tokens = extractAskTokens("Review the file for security issues.");
    expect(tokens).toEqual([]);
  });

  it("extracts a single {{ASK:}} token with its prompt text", () => {
    const tokens = extractAskTokens("Review for: {{ASK: What concern should I focus on?}}");
    expect(tokens).toHaveLength(1);
    expect(tokens[0].prompt).toBe("What concern should I focus on?");
    expect(tokens[0].placeholder).toBe("{{ASK: What concern should I focus on?}}");
  });

  it("extracts multiple tokens in left-to-right order", () => {
    const template = "Focus: {{ASK: What area?}} Depth: {{ASK: Brief or detailed?}}";
    const tokens = extractAskTokens(template);
    expect(tokens).toHaveLength(2);
    expect(tokens[0].prompt).toBe("What area?");
    expect(tokens[1].prompt).toBe("Brief or detailed?");
  });

  it("deduplicates tokens with identical prompt text — asks once, reuses answer", () => {
    const template = "Focus on {{ASK: What area?}} and also {{ASK: What area?}}";
    const tokens = extractAskTokens(template);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].prompt).toBe("What area?");
  });

  it("trims leading and trailing whitespace from the prompt text", () => {
    const tokens = extractAskTokens("{{ASK:   What area?   }}");
    expect(tokens[0].prompt).toBe("What area?");
  });

  it("does not match {{key}} input tokens — only {{ASK:}} prefix", () => {
    const tokens = extractAskTokens("Plan {{feature}} with {{ASK: What scope?}}");
    expect(tokens).toHaveLength(1);
    expect(tokens[0].prompt).toBe("What scope?");
  });
});

describe("substituteAskValues", () => {
  it("replaces a single {{ASK:}} token with its answer", () => {
    const template = "Focus on: {{ASK: What concern?}}";
    const answers = new Map([["What concern?", "security"]]);
    expect(substituteAskValues(template, answers)).toBe("Focus on: security");
  });

  it("replaces multiple distinct tokens with their respective answers", () => {
    const template = "Area: {{ASK: What area?}} — Depth: {{ASK: Brief or detailed?}}";
    const answers = new Map([
      ["What area?", "auth"],
      ["Brief or detailed?", "detailed"],
    ]);
    expect(substituteAskValues(template, answers)).toBe("Area: auth — Depth: detailed");
  });

  it("replaces all occurrences of a duplicate token with the single answer", () => {
    const template = "{{ASK: What area?}} and also {{ASK: What area?}}";
    const answers = new Map([["What area?", "performance"]]);
    expect(substituteAskValues(template, answers)).toBe("performance and also performance");
  });

  it("replaces with empty string when answer is missing from the map", () => {
    const template = "Focus on: {{ASK: What concern?}}";
    const answers = new Map<string, string>();
    expect(substituteAskValues(template, answers)).toBe("Focus on: ");
  });

  it("leaves non-ASK tokens unchanged", () => {
    const template = "Plan {{feature}} with focus: {{ASK: What concern?}}";
    const answers = new Map([["What concern?", "security"]]);
    expect(substituteAskValues(template, answers)).toBe("Plan {{feature}} with focus: security");
  });
});

describe("stripAskTokens", () => {
  it("returns unchanged template and stripped=false when no tokens present", () => {
    const { result, stripped } = stripAskTokens("No interactive prompts here.");
    expect(result).toBe("No interactive prompts here.");
    expect(stripped).toBe(false);
  });

  it("removes all {{ASK:}} tokens and reports stripped=true", () => {
    const { result, stripped } = stripAskTokens("Review for: {{ASK: What concern?}} in detail.");
    expect(result).toBe("Review for:  in detail.");
    expect(stripped).toBe(true);
  });

  it("removes multiple tokens and reports stripped=true", () => {
    const { result, stripped } = stripAskTokens("{{ASK: First?}} and {{ASK: Second?}}");
    expect(result).toBe(" and ");
    expect(stripped).toBe(true);
  });
});
