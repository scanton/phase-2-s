import { describe, it, expect, vi, afterEach } from "vitest";
import { generateEmbedding } from "../../src/core/embeddings.js";

describe("generateEmbedding", () => {
  afterEach(() => {
    vi.restoreAllMocks();
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
});
