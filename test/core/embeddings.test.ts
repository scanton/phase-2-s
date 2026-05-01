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
