import { describe, it, expect } from "vitest";
import { substituteInputs, getUnfilledInputKeys } from "../../src/skills/template.js";

const INPUTS = {
  feature: { prompt: "What feature?" },
  scope: { prompt: "Any constraints?" },
};

describe("substituteInputs", () => {
  it("replaces declared {{key}} tokens with provided values", () => {
    const result = substituteInputs(
      "Plan the {{feature}} feature. Scope: {{scope}}.",
      { feature: "auth", scope: "no SAML" },
      INPUTS,
    );
    expect(result).toBe("Plan the auth feature. Scope: no SAML.");
  });

  it("leaves undeclared {{token}} unchanged", () => {
    const result = substituteInputs(
      "Explain {{target}} to me. Feature: {{feature}}.",
      { feature: "auth" },
      INPUTS,
    );
    // {{target}} is not in INPUTS so it passes through unchanged
    expect(result).toBe("Explain {{target}} to me. Feature: auth.");
  });

  it("replaces same placeholder appearing multiple times", () => {
    const result = substituteInputs(
      "Build {{feature}}. Test {{feature}}. Deploy {{feature}}.",
      { feature: "auth" },
      INPUTS,
    );
    expect(result).toBe("Build auth. Test auth. Deploy auth.");
  });

  it("uses empty string for declared key missing from values", () => {
    const result = substituteInputs(
      "Plan the {{feature}} feature.",
      {},
      INPUTS,
    );
    expect(result).toBe("Plan the  feature.");
  });

  it("ignores extra values not declared in inputs", () => {
    const result = substituteInputs(
      "Plan {{feature}}.",
      { feature: "auth", extra: "ignored" },
      INPUTS,
    );
    expect(result).toBe("Plan auth.");
  });

  it("returns template unchanged when inputs is undefined", () => {
    const result = substituteInputs("Plan {{feature}}.", { feature: "auth" }, undefined);
    expect(result).toBe("Plan {{feature}}.");
  });

  it("handles empty string values correctly", () => {
    const result = substituteInputs("Scope: {{scope}}.", { scope: "" }, INPUTS);
    expect(result).toBe("Scope: .");
  });
});

describe("getUnfilledInputKeys", () => {
  it("returns keys whose placeholders appear in template", () => {
    const keys = getUnfilledInputKeys("Plan {{feature}}. Scope: {{scope}}.", INPUTS);
    expect(keys).toContain("feature");
    expect(keys).toContain("scope");
    expect(keys).toHaveLength(2);
  });

  it("returns only keys present as placeholders", () => {
    const keys = getUnfilledInputKeys("Plan {{feature}} only.", INPUTS);
    expect(keys).toEqual(["feature"]);
  });

  it("returns empty array when no declared keys appear in template", () => {
    const keys = getUnfilledInputKeys("No placeholders here.", INPUTS);
    expect(keys).toEqual([]);
  });

  it("returns empty array when inputs is undefined", () => {
    const keys = getUnfilledInputKeys("Plan {{feature}}.", undefined);
    expect(keys).toEqual([]);
  });

  it("does not return undeclared {{token}} keys", () => {
    const keys = getUnfilledInputKeys("Explain {{target}}.", INPUTS);
    expect(keys).toEqual([]); // {{target}} not in INPUTS
  });
});
