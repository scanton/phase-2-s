import { describe, it, expect } from "vitest";
import { isTrivialInput } from "../../src/core/rag-utils.js";

describe("isTrivialInput", () => {
  // ── Trivial inputs ─────────────────────────────────────────────────────────

  it("returns true for empty string", () => {
    expect(isTrivialInput("")).toBe(true);
  });

  it("returns true for whitespace-only string", () => {
    expect(isTrivialInput("   ")).toBe(true);
  });

  it("returns true for single word 'yes'", () => {
    expect(isTrivialInput("yes")).toBe(true);
  });

  it("returns true for single word 'no'", () => {
    expect(isTrivialInput("no")).toBe(true);
  });

  it("returns true for single word 'ok'", () => {
    expect(isTrivialInput("ok")).toBe(true);
  });

  // ── Non-trivial: 2-word inputs ────────────────────────────────────────────

  it("returns false for two-word input 'yes please'", () => {
    expect(isTrivialInput("yes please")).toBe(false);
  });

  it("returns false for two-word input 'go ahead'", () => {
    expect(isTrivialInput("go ahead")).toBe(false);
  });

  it("returns false for two-word input '  ok sure  ' (trimmed)", () => {
    expect(isTrivialInput("  ok sure  ")).toBe(false);
  });

  it("returns false for two-word input 'add tests'", () => {
    expect(isTrivialInput("add tests")).toBe(false);
  });

  it("returns false for two-word input 'fix typo'", () => {
    expect(isTrivialInput("fix typo")).toBe(false);
  });

  // ── Non-trivial: 3+ words ──────────────────────────────────────────────────

  it("returns false for 3-word input 'fix the bug'", () => {
    expect(isTrivialInput("fix the bug")).toBe(false);
  });

  it("returns false for 'fix the auth bug please' (5 words)", () => {
    expect(isTrivialInput("fix the auth bug please")).toBe(false);
  });

  it("returns false for 'write tests for the parser'", () => {
    expect(isTrivialInput("write tests for the parser")).toBe(false);
  });

  // ── Non-trivial: colon commands ────────────────────────────────────────────

  it("returns false for ':help' (single-token colon command)", () => {
    expect(isTrivialInput(":help")).toBe(false);
  });

  it("returns false for ':compact' (single-token colon command)", () => {
    expect(isTrivialInput(":compact")).toBe(false);
  });

  it("returns false for ':search foo' (colon command with payload)", () => {
    expect(isTrivialInput(":search foo")).toBe(false);
  });

  it("returns false for ':search the auth handler' (colon command + multiple words)", () => {
    expect(isTrivialInput(":search the auth handler")).toBe(false);
  });

  it("returns false for ':ls' even though it is one token", () => {
    expect(isTrivialInput(":ls")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isTrivialInput — minWords parameter (Sprint 85)
// ---------------------------------------------------------------------------

// minWords semantics: trivial when parts.length <= minWords
// - minWords=0 → only empty strings are trivial
// - minWords=1 → empty and single-word inputs are trivial (default)
// - minWords=2 → empty, single-word, AND two-word inputs are trivial

describe("isTrivialInput — minWords parameter", () => {
  it("minWords=1 (default): single word 'help' is trivial", () => {
    expect(isTrivialInput("help", 1)).toBe(true);
  });

  it("minWords=1 (default): two-word 'add tests' is NOT trivial", () => {
    expect(isTrivialInput("add tests", 1)).toBe(false);
  });

  it("minWords=2: single word 'help' is trivial (still within threshold)", () => {
    expect(isTrivialInput("help", 2)).toBe(true);
  });

  it("minWords=2: two-word 'yes please' is trivial (exactly at threshold)", () => {
    expect(isTrivialInput("yes please", 2)).toBe(true);
  });

  it("minWords=2: three-word 'fix the bug' is NOT trivial (above threshold)", () => {
    expect(isTrivialInput("fix the bug", 2)).toBe(false);
  });

  it("minWords=0: empty string is trivial (zero words <= 0)", () => {
    expect(isTrivialInput("", 0)).toBe(true);
  });

  it("minWords=0: single word 'x' is NOT trivial (1 word > 0 threshold)", () => {
    expect(isTrivialInput("x", 0)).toBe(false);
  });

  it("minWords=0: colon command ':help' is still NOT trivial (colon rule takes priority)", () => {
    expect(isTrivialInput(":help", 0)).toBe(false);
  });

  it("no minWords arg: backward-compatible with existing callers (single word trivial)", () => {
    expect(isTrivialInput("yes")).toBe(true);
    expect(isTrivialInput("add tests")).toBe(false);
  });
});
