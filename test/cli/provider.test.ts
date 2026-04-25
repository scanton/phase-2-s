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

  it("malformed config — shows all providers without (active) marker", async () => {
    writeFileSync(join(tmpDir, ".phase2s.yaml"), "key: [unclosed\n");
    await withCwd(tmpDir, () => runProviderList());
    const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).not.toContain("(active)");
    for (const p of ["codex-cli", "openai-api", "anthropic"]) {
      expect(output).toContain(p);
    }
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

  it("provider switch clears ollamaEmbedModel alongside model/fast_model", async () => {
    writeFileSync(
      join(tmpDir, ".phase2s.yaml"),
      "provider: ollama\nmodel: gemma4:latest\nollamaEmbedModel: gemma4:latest\nollamaBaseUrl: http://localhost:11434/v1\n",
    );
    mockAnswer = "sk-openai-test";

    await withCwd(tmpDir, async () => {
      await runProviderLogin("openai-api");
    });

    const written = yamlParse(readFileSync(join(tmpDir, ".phase2s.yaml"), "utf-8")) as Record<string, unknown>;
    expect(written.provider).toBe("openai-api");
    expect(written.model).toBeUndefined();
    expect(written.ollamaEmbedModel).toBeUndefined(); // cleared on provider switch
  });

  it("invalid YAML file → exits with error, does not overwrite", async () => {
    const configPath = join(tmpDir, ".phase2s.yaml");
    writeFileSync(configPath, "key: [unclosed\n");

    await withCwd(tmpDir, async () => {
      await expect(runProviderLogin("openai-api")).rejects.toThrow("process.exit called");
    });

    // File must not have been overwritten
    expect(readFileSync(configPath, "utf-8")).toBe("key: [unclosed\n");
    const errOutput = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(errOutput).toContain("invalid YAML");
  });

  it("list YAML file → exits with error, does not silently overwrite", async () => {
    const configPath = join(tmpDir, ".phase2s.yaml");
    const listContent = "- item1\n- item2\n";
    writeFileSync(configPath, listContent);

    await withCwd(tmpDir, async () => {
      await expect(runProviderLogin("openai-api")).rejects.toThrow("process.exit called");
    });

    // File must not have been silently replaced with an empty object
    expect(readFileSync(configPath, "utf-8")).toBe(listContent);
    const errOutput = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(errOutput).toContain("invalid YAML");
  });

  it("empty API key → exits with error, does not write config", async () => {
    mockAnswer = "";

    await withCwd(tmpDir, async () => {
      await expect(runProviderLogin("openai-api")).rejects.toThrow("process.exit called");
    });

    const { existsSync } = await import("node:fs");
    expect(existsSync(join(tmpDir, ".phase2s.yaml"))).toBe(false);
    const errOutput = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(errOutput).toContain("empty");
  });

  it("re-login same provider — model fields NOT cleared", async () => {
    writeFileSync(
      join(tmpDir, ".phase2s.yaml"),
      "provider: openai-api\napiKey: old-key\nmodel: gpt-4o\nfast_model: gpt-4o-mini\n",
    );
    mockAnswer = "sk-new-key";

    await withCwd(tmpDir, async () => {
      await runProviderLogin("openai-api");
    });

    const written = yamlParse(readFileSync(join(tmpDir, ".phase2s.yaml"), "utf-8")) as Record<string, unknown>;
    expect(written.provider).toBe("openai-api");
    expect(written.apiKey).toBe("sk-new-key");
    expect(written.model).toBe("gpt-4o"); // NOT cleared — same provider
    expect(written.fast_model).toBe("gpt-4o-mini"); // NOT cleared
  });

  it("ollama (no keyField) — no key prompt, just writes provider", async () => {
    await withCwd(tmpDir, async () => {
      await runProviderLogin("ollama");
    });

    const written = yamlParse(readFileSync(join(tmpDir, ".phase2s.yaml"), "utf-8")) as Record<string, unknown>;
    expect(written.provider).toBe("ollama");
    // No key field should be written
    expect(written.apiKey).toBeUndefined();
    expect(written.ollamaApiKey).toBeUndefined();

    const out = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(out).toContain("✔");
  });

  it("config file written with 0o600 permissions", async () => {
    mockAnswer = "sk-perm-test";

    await withCwd(tmpDir, async () => {
      await runProviderLogin("openai-api");
    });

    const configPath = join(tmpDir, ".phase2s.yaml");
    const mode = statSync(configPath).mode & 0o777;
    expect(mode).toBe(0o600);
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
    const configPath = join(tmpDir, ".phase2s.yaml");
    writeFileSync(configPath, "provider: codex-cli\n");

    await withCwd(tmpDir, () => runProviderLogout());

    // Content check is more reliable than mtime (APFS has 1-second mtime granularity)
    expect(readFileSync(configPath, "utf-8")).toBe("provider: codex-cli\n");

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

  it("malformed config — exits with error, does not overwrite", async () => {
    const configPath = join(tmpDir, ".phase2s.yaml");
    writeFileSync(configPath, "key: [unclosed\n");

    await withCwd(tmpDir, () => {
      expect(() => runProviderLogout()).toThrow("process.exit called");
    });

    expect(readFileSync(configPath, "utf-8")).toBe("key: [unclosed\n");
    const errOutput = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(errOutput).toContain("invalid YAML");
  });

  it("key field absent from config — prints warning, does not write", async () => {
    const configPath = join(tmpDir, ".phase2s.yaml");
    writeFileSync(configPath, "provider: anthropic\n");

    await withCwd(tmpDir, () => runProviderLogout());

    // Content check is more reliable than mtime (APFS has 1-second mtime granularity)
    expect(readFileSync(configPath, "utf-8")).toBe("provider: anthropic\n");

    const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).toContain("nothing to clear");
  });
});
