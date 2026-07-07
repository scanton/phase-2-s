import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { generateEmbedding, _clearEmbedCache } from "../../src/core/embeddings.js";

describe("generateEmbedding", () => {
  beforeEach(() => {
    _clearEmbedCache();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("caches successful embeds — repeated identical query makes one fetch", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embeddings: [[0.7, 0.8]] }),
    } as Response);
    vi.stubGlobal("fetch", mockFetch);

    const first = await generateEmbedding("same query", "gemma4:latest", "http://localhost:11434/v1");
    const second = await generateEmbedding("same query", "gemma4:latest", "http://localhost:11434/v1");

    expect(first).toEqual([0.7, 0.8]);
    expect(second).toEqual([0.7, 0.8]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("does not cache failures — a down Ollama is retried on the next call", async () => {
    const mockFetch = vi.fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ embeddings: [[0.9]] }),
      } as Response);
    vi.stubGlobal("fetch", mockFetch);

    expect(await generateEmbedding("q", "gemma4:latest", "http://localhost:11434/v1")).toEqual([]);
    expect(await generateEmbedding("q", "gemma4:latest", "http://localhost:11434/v1")).toEqual([0.9]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("cache key includes model — same text with a different model re-fetches", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embeddings: [[0.1]] }),
    } as Response);
    vi.stubGlobal("fetch", mockFetch);

    await generateEmbedding("text", "model-a", "http://localhost:11434/v1");
    await generateEmbedding("text", "model-b", "http://localhost:11434/v1");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("strips /v1 suffix and calls /api/embed", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embeddings: [[0.1, 0.2, 0.3]] }),
    } as Response);
    vi.stubGlobal("fetch", mockFetch);

    const result = await generateEmbedding("hello world", "gemma4:latest", "http://localhost:11434/v1");

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:11434/api/embed",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result).toEqual([0.1, 0.2, 0.3]);
  });

  it("returns [] when Ollama returns non-200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) } as Response));

    const result = await generateEmbedding("test", "gemma4:latest", "http://localhost:11434/v1");

    expect(result).toEqual([]);
  });

  it("returns [] on network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const result = await generateEmbedding("test", "gemma4:latest", "http://localhost:11434/v1");

    expect(result).toEqual([]);
  });

  it("handles baseUrl without /v1 suffix", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embeddings: [[0.5]] }),
    } as Response);
    vi.stubGlobal("fetch", mockFetch);

    await generateEmbedding("test", "gemma4:latest", "http://localhost:11434");

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:11434/api/embed",
      expect.anything(),
    );
  });

  it("returns [] for file:// baseUrl (non-HTTP scheme)", async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    const result = await generateEmbedding("test", "gemma4:latest", "file:///etc/passwd");

    expect(result).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns [] for data: baseUrl (non-HTTP scheme)", async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    const result = await generateEmbedding("test", "gemma4:latest", "data:text/plain,hello");

    expect(result).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns [] for empty baseUrl", async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    const result = await generateEmbedding("test", "gemma4:latest", "");

    expect(result).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns [] when response has no embeddings field", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response));

    const result = await generateEmbedding("test", "gemma4:latest", "http://localhost:11434/v1");

    expect(result).toEqual([]);
  });
});
