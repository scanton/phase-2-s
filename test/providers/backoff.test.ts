/**
 * Tests for src/providers/backoff.ts.
 *
 * Verifies the shared rate-limit constants and utilities are correctly exported
 * and that the re-exports from openai.ts remain intact for backward compatibility.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { MAX_RATE_LIMIT_RETRIES, sleep, parseRetryAfter } from "../../src/providers/backoff.js";
// Verify backward-compat re-exports from openai.ts still resolve
import {
  MAX_RATE_LIMIT_RETRIES as openaiMaxRetries,
  sleep as openaiSleep,
  parseRetryAfter as openaiParseRetryAfter,
} from "../../src/providers/openai.js";

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// backoff.ts — exported values and functions
// ---------------------------------------------------------------------------

describe("backoff.ts exports", () => {
  it("MAX_RATE_LIMIT_RETRIES is 3", () => {
    expect(MAX_RATE_LIMIT_RETRIES).toBe(3);
  });

  it("sleep resolves after the given delay", async () => {
    vi.useFakeTimers();
    const promise = sleep(1000);
    vi.advanceTimersByTime(1000);
    await expect(promise).resolves.toBeUndefined();
  });

  it("parseRetryAfter: integer string → number (capped at 3600)", () => {
    expect(parseRetryAfter("47")).toBe(47);
    expect(parseRetryAfter("0")).toBe(0);
    expect(parseRetryAfter("99999999")).toBe(3600);
  });

  it("parseRetryAfter: HTTP-date string → seconds until that date", () => {
    // A date 100 seconds in the future
    const futureDate = new Date(Date.now() + 100_000);
    const result = parseRetryAfter(futureDate.toUTCString());
    // Allow ±2s for execution time
    expect(result).toBeGreaterThanOrEqual(98);
    expect(result).toBeLessThanOrEqual(102);
  });

  it("parseRetryAfter: undefined → undefined", () => {
    expect(parseRetryAfter(undefined)).toBeUndefined();
  });

  it("parseRetryAfter: empty string → undefined", () => {
    expect(parseRetryAfter("")).toBeUndefined();
  });

  it("parseRetryAfter: invalid string → undefined", () => {
    expect(parseRetryAfter("not-a-date-or-number")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// openai.ts re-exports — backward compatibility
// ---------------------------------------------------------------------------

describe("openai.ts backward-compat re-exports", () => {
  it("MAX_RATE_LIMIT_RETRIES is the same value as backoff.ts", () => {
    expect(openaiMaxRetries).toBe(MAX_RATE_LIMIT_RETRIES);
  });

  it("sleep re-export resolves the same way", async () => {
    vi.useFakeTimers();
    const promise = openaiSleep(500);
    vi.advanceTimersByTime(500);
    await expect(promise).resolves.toBeUndefined();
  });

  it("parseRetryAfter re-export parses integers correctly", () => {
    expect(openaiParseRetryAfter("30")).toBe(30);
  });
});
