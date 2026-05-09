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
