/**
 * RateLimitError — thrown when a provider returns HTTP 429 (Too Many Requests)
 * and the auto-backoff budget is exhausted or the retry delay is too long.
 *
 * Distinct from generic Error so callers can handle it specifically:
 *   - REPL: print resume message + exit 0
 *   - goal runner: checkpoint + print resume message + exit 2
 *   - parallel-executor: re-throw (do NOT collect as a failed worker)
 *
 * NOT caught by the satori retry loop — must propagate up to the CLI layer.
 */
export class RateLimitError extends Error {
  /** Seconds until the rate limit resets, from the provider's Retry-After header. */
  readonly retryAfter: number | undefined;
  /** Provider name (e.g. "openai-api", "anthropic"). */
  readonly providerName: string | undefined;

  constructor(retryAfter?: number, providerName?: string) {
    super(
      retryAfter !== undefined
        ? `Rate limited by ${providerName ?? "provider"} — retry after ${retryAfter}s`
        : `Rate limited by ${providerName ?? "provider"}`,
    );
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
    this.providerName = providerName;
  }
}
