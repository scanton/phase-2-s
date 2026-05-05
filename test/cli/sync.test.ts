import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Module-level mock fn references — set up before vi.mock() factories
// ---------------------------------------------------------------------------

const syncCodebaseMock = vi.fn() as Mock;
const generateEmbeddingMock = vi.fn() as Mock;

vi.mock("../../src/core/code-index.js", () => ({
  syncCodebase: syncCodebaseMock,
}));

vi.mock("../../src/core/embeddings.js", () => ({
  generateEmbedding: generateEmbeddingMock,
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runSync", () => {
  let tmpDir: string;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sync-test-"));
    await mkdir(join(tmpDir, ".phase2s"), { recursive: true });

    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    exitSpy = vi.spyOn(process, "exit").mockImplementation((_code?: number) => {
      throw new Error(`process.exit(${_code})`);
    });
    syncCodebaseMock.mockReset();
    generateEmbeddingMock.mockReset();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("exits 1 when ollamaBaseUrl is not configured", async () => {
    const { runSync } = await import("../../src/cli/sync.js");
    const config = { ollamaBaseUrl: undefined } as never;

    await expect(runSync(tmpDir, config)).rejects.toThrow("process.exit(1)");

    expect(exitSpy).toHaveBeenCalledWith(1);
    const errorOutput = consoleErrorSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(errorOutput).toMatch(/ollamaBaseUrl/);
    expect(errorOutput).toMatch(/phase2s init/);
  });

  it("calls syncCodebase and prints the indexed/skipped/removed report", async () => {
    syncCodebaseMock.mockResolvedValue({ indexed: 42, skipped: 10, removed: 3, failed: 0, chunks: 0 });

    const { runSync } = await import("../../src/cli/sync.js");
    const config = {
      ollamaBaseUrl: "http://localhost:11434/v1",
      ollamaEmbedModel: "nomic-embed-text:latest",
    } as never;

    await runSync(tmpDir, config);

    const logOutput = consoleLogSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logOutput).toMatch(/42/);
    expect(logOutput).toMatch(/10/);
    expect(logOutput).toMatch(/3/);
  });

  it("includes chunk count in output when chunks > 0", async () => {
    syncCodebaseMock.mockResolvedValue({ indexed: 5, skipped: 2, removed: 0, failed: 0, chunks: 47 });

    const { runSync } = await import("../../src/cli/sync.js");
    const config = {
      ollamaBaseUrl: "http://localhost:11434/v1",
    } as never;

    await runSync(tmpDir, config);

    const logOutput = consoleLogSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logOutput).toMatch(/47.*chunk/);
  });

  it("uses singular 'chunk' when chunks is 1 (S3)", async () => {
    syncCodebaseMock.mockResolvedValue({ indexed: 1, skipped: 0, removed: 0, failed: 0, chunks: 1 });

    const { runSync } = await import("../../src/cli/sync.js");
    const config = {
      ollamaBaseUrl: "http://localhost:11434/v1",
    } as never;

    await runSync(tmpDir, config);

    const logOutput = consoleLogSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    // Should say "1 chunk" not "1 chunks"
    expect(logOutput).toMatch(/1 chunk\b/);
    expect(logOutput).not.toMatch(/1 chunks/);
  });

  it("omits chunk note when chunks is 0", async () => {
    syncCodebaseMock.mockResolvedValue({ indexed: 3, skipped: 0, removed: 0, failed: 0, chunks: 0 });

    const { runSync } = await import("../../src/cli/sync.js");
    const config = {
      ollamaBaseUrl: "http://localhost:11434/v1",
    } as never;

    await runSync(tmpDir, config);

    const logOutput = consoleLogSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logOutput).not.toMatch(/chunk/);
  });

  it("prints index path in output", async () => {
    syncCodebaseMock.mockResolvedValue({ indexed: 1, skipped: 0, removed: 0, failed: 0, chunks: 0 });

    const { runSync } = await import("../../src/cli/sync.js");
    const config = {
      ollamaBaseUrl: "http://localhost:11434/v1",
    } as never;

    await runSync(tmpDir, config);

    const allOutput = [
      ...consoleLogSpy.mock.calls.map((c) => c.join(" ")),
      ...stdoutSpy.mock.calls.map((c) => c.join(" ")),
    ].join("\n");
    expect(allOutput).toMatch(/code-index\.jsonl/);
  });

  it("exits 1 and prints error when syncCodebase throws", async () => {
    syncCodebaseMock.mockRejectedValue(new Error("phase2s sync requires a git repository"));

    const { runSync } = await import("../../src/cli/sync.js");
    const config = {
      ollamaBaseUrl: "http://localhost:11434/v1",
    } as never;

    await expect(runSync(tmpDir, config)).rejects.toThrow("process.exit(1)");

    const errorOutput = consoleErrorSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(errorOutput).toMatch(/git repository/);
  });
});
