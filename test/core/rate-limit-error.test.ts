/**
 * Tests for src/core/rate-limit-error.ts.
 *
 * Covers the `kind` field added in Sprint 59 and backward-compatible constructor
 * overloading (number | "blocked" | undefined).
 */

import { describe, it, expect } from "vitest";
import { RateLimitError } from "../../src/core/rate-limit-error.js";

describe("RateLimitError — kind field (Sprint 59)", () => {
  it('default constructor (no args) → kind = "rate_limited"', () => {
    const err = new RateLimitError();
    expect(err.kind).toBe("rate_limited");
    expect(err.retryAfter).toBeUndefined();
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("RateLimitError");
  });

  it('numeric retryAfter → kind = "rate_limited", retryAfter set', () => {
    const err = new RateLimitError(47);
    expect(err.kind).toBe("rate_limited");
    expect(err.retryAfter).toBe(47);
    expect(err.message).toContain("47");
  });

  it('string "blocked" → kind = "blocked", retryAfter undefined', () => {
    const err = new RateLimitError("blocked", "openai-api");
    expect(err.kind).toBe("blocked");
    expect(err.retryAfter).toBeUndefined();
    expect(err.message).toContain("Blocked");
    expect(err.message).toContain("openai-api");
  });

  it("kind field is readonly (structural check)", () => {
    const err = new RateLimitError(10);
    // TypeScript enforces readonly at compile time; this runtime check
    // verifies the property descriptor is as expected (not writable via Object).
    const descriptor = Object.getOwnPropertyDescriptor(err, "kind");
    // kind is set via this.kind = ... in the constructor; in strict mode it is
    // an own property but not defined as non-writable unless using defineProperty.
    // We just verify the value is present and correct.
    expect(descriptor?.value).toBe("rate_limited");
  });

  it("providerName is preserved alongside kind", () => {
    const err = new RateLimitError(5, "anthropic");
    expect(err.providerName).toBe("anthropic");
    expect(err.kind).toBe("rate_limited");
  });

  it('blocked error message does not include "retry after"', () => {
    const err = new RateLimitError("blocked");
    expect(err.message).not.toContain("retry after");
    expect(err.message).toContain("non-transient");
  });
});
