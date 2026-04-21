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
 *
 * The `kind` field distinguishes two cases:
 *   - "rate_limited": standard HTTP 429, provider will accept requests after retryAfter
 *   - "blocked": provider refused the request for policy reasons (e.g. content filter
 *     that also returns 429, or account-level block). Callers may choose to surface
 *     a different message for blocked vs. transient rate limits.
 */
export class RateLimitError extends Error {
  /** Seconds until the rate limit resets, from the provider's Retry-After header. */
  readonly retryAfter: number | undefined;
  /** Provider name (e.g. "openai-api", "anthropic"). */
  readonly providerName: string | undefined;
  /**
   * Why the request was rejected.
   * - "rate_limited": transient 429, will recover after retryAfter seconds
   * - "blocked": non-transient provider refusal (policy, content, account block)
   */
  readonly kind: "rate_limited" | "blocked";

  /**
   * @param retryAfterOrKind  Number of seconds to wait before retrying, OR the
   *   string "blocked" to indicate a non-transient refusal. Pass undefined for an
   *   ordinary rate limit with no Retry-After header.
   * @param providerName  Human-readable provider identifier for the error message.
   */
  constructor(retryAfterOrKind?: number | "blocked", providerName?: string) {
    const kind: "rate_limited" | "blocked" =
      retryAfterOrKind === "blocked" ? "blocked" : "rate_limited";
    const retryAfter: number | undefined =
      typeof retryAfterOrKind === "number" ? retryAfterOrKind : undefined;

    super(
      kind === "blocked"
        ? `Blocked by ${providerName ?? "provider"} (non-transient refusal)`
        : retryAfter !== undefined
          ? `Rate limited by ${providerName ?? "provider"} — retry after ${retryAfter}s`
          : `Rate limited by ${providerName ?? "provider"}`,
    );
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
    this.providerName = providerName;
    this.kind = kind;
  }
}
