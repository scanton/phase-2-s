/**
 * schemaGate<T> — validate structured LLM output against a typed predicate.
 *
 * Calls fn(), parses the returned string as JSON, validates with validate().
 * On failure: passes the raw error string as the retryContext argument to the
 * next call of fn(). On max retries exceeded: throws with the last error.
 *
 * fn() must return the extracted text content string (not a provider response
 * object). The caller is responsible for content extraction from provider responses.
 */
export async function schemaGate<T>(
  fn: (retryContext?: string) => Promise<string>,
  validate: (parsed: unknown) => parsed is T,
  retries = 2,
): Promise<T> {
  let lastError: string | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const raw = await fn(lastError);  // throws propagate immediately (network, provider)

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      lastError = `JSON parse error: ${e instanceof Error ? e.message : String(e)}. Raw output: ${raw.slice(0, 200)}`;
      continue;
    }

    if (validate(parsed)) {
      return parsed;
    }

    lastError = `Validation failed. Output did not match expected schema. Got: ${JSON.stringify(parsed).slice(0, 200)}`;
  }

  throw new Error(`schemaGate: max retries (${retries}) exceeded. Last error: ${lastError}`);
}
