/**
 * Ollama embedding client.
 *
 * Uses the native /api/embed endpoint (not the OpenAI-compat /v1/embeddings),
 * so ollamaBaseUrl ("http://localhost:11434/v1") has the /v1 suffix stripped
 * before constructing the request URL.
 *
 * Returns an empty array on any error so callers can fall back gracefully.
 */

export async function generateEmbedding(
  text: string,
  model: string,
  baseUrl: string,
): Promise<number[]> {
  if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) return [];
  try {
    // Strip /v1 suffix — ollamaBaseUrl is stored with /v1 for OpenAI-compat API,
    // but the native embed endpoint lives at /api/embed (no /v1).
    const baseHost = baseUrl.replace(/\/v1\/?$/, "");
    const url = `${baseHost}/api/embed`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: text }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) return [];

    const data = (await res.json()) as { embeddings?: number[][] };
    const vec = data.embeddings?.[0];
    if (!Array.isArray(vec) || vec.length === 0) return [];
    return vec;
  } catch {
    return [];
  }
}
