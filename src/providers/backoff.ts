/**
 * Shared rate-limit backoff constants and utilities.
 *
 * These are used by OpenAIProvider and AnthropicProvider (which each manage their
 * own retry loop) and are available for future providers. There is intentionally no
 * `withRateLimitBackoff` wrapper because mid-stream 429s fire inside an
 * `AsyncIterable`, not a `Promise<T>`, and cannot be cleanly wrapped as a thunk.
 */

/**
 * Maximum number of auto-backoff *attempts* before yielding rate_limited.
 * The loop condition `rateLimitAttempts < MAX_RATE_LIMIT_RETRIES` allows
 * attempts 0, 1, 2 — so the first attempt + 2 retries = 3 total calls.
 * Named "RETRIES" for historical reasons; it's really the attempt ceiling.
 */
export const MAX_RATE_LIMIT_RETRIES = 3;

/**
 * Maximum value (in seconds) for the Retry-After header cap.
 * Very large values (e.g. 99999999) × 1000 overflow setTimeout's 32-bit signed int.
 * 3600 s (1 hour) is the practical maximum any provider sets.
 */
export const MAX_RETRY_AFTER_SECONDS = 3600;

/** Sleep for the given number of milliseconds (used for rate-limit backoff). */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse the Retry-After header value into seconds.
 * Handles both integer-seconds form ("47") and HTTP-date form.
 * Returns undefined if parsing fails.
 */
export function parseRetryAfter(header: string | undefined): number | undefined {
  if (!header) return undefined;
  const seconds = parseInt(header, 10);
  if (!isNaN(seconds) && seconds >= 0) return Math.min(seconds, MAX_RETRY_AFTER_SECONDS);
  // HTTP-date form: "Wed, 21 Oct 2025 07:28:00 GMT"
  const date = Date.parse(header);
  if (!isNaN(date)) {
    const diff = Math.ceil((date - Date.now()) / 1000);
    return diff > 0 ? Math.min(diff, MAX_RETRY_AFTER_SECONDS) : 0;
  }
  return undefined;
}
