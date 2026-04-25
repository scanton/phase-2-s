import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mock readline at top level — provider login uses it for interactive prompts.
// The mock answer is configured per-test via mockAnswer.
let mockAnswer = "sk-test-key";
vi.mock("node:readline", () => ({
  createInterface: () => ({
    question: (_prompt: string, cb: (a: string) => void) => cb(mockAnswer),
    close: vi.fn(),
  }),
}));

import { runProviderList, runProviderLogout, runProviderLogin } from "../../src/cli/provider.js";
import { parse as yamlParse } from "yaml";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function withCwd(dir: string, fn: () => Promise<void> | void): Promise<void> {
  const orig = process.cwd();
  process.chdir(dir);
  try {
    await fn();
  } finally {
    process.chdir(orig);
  }
}

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "provider-test-"));
}

// ---------------------------------------------------------------------------
// runProviderList
// ---------------------------------------------------------------------------

describe("runProviderList", () => {
  let tmpDir: string;
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    writeSpy.mockRestore();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("lists all 7 supported providers", async () => {
    await withCwd(tmpDir, () => runProviderList());
    const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    for (const p of ["codex-cli", "openai-api", "anthropic", "ollama", "openrouter", "gemini", "minimax"]) {
      expect(output).toContain(p);
    }
  });

  it("marks configured provider as (active)", async () => {
    writeFileSync(join(tmpDir, ".phase2s.yaml"), "provider: anthropic\n");
    await withCwd(tmpDir, () => runProviderList());
    const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).toMatch(/anthropic.*\(active\)/);
    expect(output).not.toMatch(/codex-cli.*\(active\)/);
  });

  it("works with no config file — shows all providers, none active", async () => {
    await withCwd(tmpDir, () => runProviderList());
    const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).not.toContain("(active)");
  });

  it("shows PHASE2S_PROVIDER env override warning", async () => {
    process.env.PHASE2S_PROVIDER = "gemini";
    try {
      await withCwd(tmpDir, () => runProviderList());
      const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
      expect(output).toContain("PHASE2S_PROVIDER=gemini");
    } finally {
      delete process.env.PHASE2S_PROVIDER;
    }
  });
});

// ---------------------------------------------------------------------------
// runProviderLogin
// ---------------------------------------------------------------------------

describe("runProviderLogin", () => {
  let tmpDir: string;
  let writeSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    mockAnswer = "sk-test-key";
    writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as never);
  });

  afterEach(() => {
    writeSpy.mockRestore();
    stderrSpy.mockRestore();
    exitSpy.mockRestore();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("invalid provider → writes error and exits without creating config", async () => {
    await withCwd(tmpDir, async () => {
      await expect(runProviderLogin("bad-provider-name")).rejects.toThrow("process.exit called");
    });
    const { existsSync } = await import("node:fs");
    expect(existsSync(join(tmpDir, ".phase2s.yaml"))).toBe(false);
  });

  it("valid provider with key: writes provider + keyField, clears model, preserves other fields", async () => {
    writeFileSync(
      join(tmpDir, ".phase2s.yaml"),
      "provider: codex-cli\nmodel: gpt-4o\nfast_model: gpt-4o-mini\nslack_webhook: https://hooks.example.com\n",
    );
    mockAnswer = "sk-openai-test";

    await withCwd(tmpDir, async () => {
      await runProviderLogin("openai-api");
    });

    const written = yamlParse(readFileSync(join(tmpDir, ".phase2s.yaml"), "utf-8")) as Record<string, unknown>;
    expect(written.provider).toBe("openai-api");
    expect(written.apiKey).toBe("sk-openai-test");
    expect(written.model).toBeUndefined(); // cleared on provider switch
    expect(written.fast_model).toBeUndefined(); // cleared on switch — provider-specific model slugs
    expect(written.slack_webhook).toBe("https://hooks.example.com"); // preserved

    const out = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(out).toContain("✔");
  });
});

// ---------------------------------------------------------------------------
// runProviderLogout
// ---------------------------------------------------------------------------

describe("runProviderLogout", () => {
  let tmpDir: string;
  let writeSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as never);
  });

  afterEach(() => {
    writeSpy.mockRestore();
    stderrSpy.mockRestore();
    exitSpy.mockRestore();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("API key provider: removes key field, prints success, leaves provider intact", async () => {
    writeFileSync(
      join(tmpDir, ".phase2s.yaml"),
      "provider: anthropic\nanthropicApiKey: sk-ant-test\nfast_model: claude-3-haiku\n",
    );

    await withCwd(tmpDir, () => runProviderLogout());

    const written = yamlParse(readFileSync(join(tmpDir, ".phase2s.yaml"), "utf-8")) as Record<string, unknown>;
    expect(written.provider).toBe("anthropic"); // intact
    expect(written.anthropicApiKey).toBeUndefined(); // cleared
    expect(written.fast_model).toBe("claude-3-haiku"); // preserved

    const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).toContain("✔");
    expect(output).toContain("anthropic");
  });

  it("codex-cli: prints informational message, no file write", async () => {
    writeFileSync(join(tmpDir, ".phase2s.yaml"), "provider: codex-cli\n");
    const originalMtime = statSync(join(tmpDir, ".phase2s.yaml")).mtimeMs;

    await withCwd(tmpDir, () => runProviderLogout());

    const newMtime = statSync(join(tmpDir, ".phase2s.yaml")).mtimeMs;
    expect(newMtime).toBe(originalMtime); // file not modified

    const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).toContain("No credentials stored locally");
  });

  it("no config file: exits with error, does not throw", async () => {
    await withCwd(tmpDir, () => {
      expect(() => runProviderLogout()).toThrow("process.exit called");
    });
    const errOutput = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(errOutput).toContain("No .phase2s.yaml");
  });
});
