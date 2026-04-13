/**
 * Tests for src/cli/model-resolver.ts
 *
 * Pure function coverage — no mocking required.
 */
import { describe, it, expect } from "vitest";
import { resolveReasoningModel, resolveAgentModel } from "../../src/cli/model-resolver.js";

// ---------------------------------------------------------------------------
// resolveReasoningModel
// ---------------------------------------------------------------------------

describe("resolveReasoningModel", () => {
  const full = { smart_model: "claude-opus-4-5", fast_model: "gpt-4o-mini", model: "gpt-4o" };

  it("returns smart_model for 'high' override", () => {
    expect(resolveReasoningModel("high", full)).toBe("claude-opus-4-5");
  });

  it("returns fast_model for 'low' override", () => {
    expect(resolveReasoningModel("low", full)).toBe("gpt-4o-mini");
  });

  it("returns undefined for no override (undefined)", () => {
    expect(resolveReasoningModel(undefined, full)).toBeUndefined();
  });

  it("returns undefined when 'high' but smart_model not configured", () => {
    expect(resolveReasoningModel("high", { fast_model: "gpt-4o-mini" })).toBeUndefined();
  });

  it("returns undefined when 'low' but fast_model not configured", () => {
    expect(resolveReasoningModel("low", { smart_model: "claude-opus-4-5" })).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// resolveAgentModel
// ---------------------------------------------------------------------------

describe("resolveAgentModel", () => {
  const full = { smart_model: "claude-opus-4-5", fast_model: "gpt-4o-mini", model: "gpt-4o" };

  it("returns smart_model for 'smart' tier", () => {
    expect(resolveAgentModel("smart", full)).toBe("claude-opus-4-5");
  });

  it("returns fast_model for 'fast' tier", () => {
    expect(resolveAgentModel("fast", full)).toBe("gpt-4o-mini");
  });

  it("passes through a literal model string unchanged", () => {
    expect(resolveAgentModel("gpt-4o", full)).toBe("gpt-4o");
    expect(resolveAgentModel("claude-3-5-sonnet-20241022", full)).toBe("claude-3-5-sonnet-20241022");
  });

  it("returns undefined when 'smart' but smart_model not configured", () => {
    expect(resolveAgentModel("smart", { fast_model: "gpt-4o-mini" })).toBeUndefined();
  });

  it("returns undefined when 'fast' but fast_model not configured", () => {
    expect(resolveAgentModel("fast", { smart_model: "claude-opus-4-5" })).toBeUndefined();
  });
});
