import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Mock child_process — spawnSync used by checkProviderBinary
// ---------------------------------------------------------------------------

const spawnSyncMock = vi.fn();

vi.mock("node:child_process", () => ({
  spawnSync: spawnSyncMock,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "phase2s-doctor-test-"));
}

// ---------------------------------------------------------------------------
// checkNodeVersion
// ---------------------------------------------------------------------------

describe("checkNodeVersion", () => {
  it("passes when current Node version is >= 20", async () => {
    const { checkNodeVersion } = await import("../../src/cli/doctor.js");
    // The test process runs Node >= 20 (required by phase2s itself)
    const result = checkNodeVersion();
    expect(result.name).toBe("Node.js version");
    expect(result.ok).toBe(true);
    expect(result.detail).toMatch(/^v\d+/);
    expect(result.fix).toBeUndefined();
  });

  it("fails when major version is below 20", async () => {
    const { checkNodeVersion } = await import("../../src/cli/doctor.js");
    const original = process.version;
    Object.defineProperty(process, "version", { value: "v18.20.0", configurable: true });
    const result = checkNodeVersion();
    Object.defineProperty(process, "version", { value: original, configurable: true });
    expect(result.ok).toBe(false);
    expect(result.fix).toContain("nodejs.org");
  });
});

// ---------------------------------------------------------------------------
// checkProviderBinary
// ---------------------------------------------------------------------------

describe("checkProviderBinary", () => {
  beforeEach(() => spawnSyncMock.mockReset());

  it("codex-cli: returns ok when binary exits 0", async () => {
    spawnSyncMock.mockReturnValue({ status: 0, error: null });
    const { checkProviderBinary } = await import("../../src/cli/doctor.js");
    const result = checkProviderBinary("codex-cli");
    expect(result.ok).toBe(true);
    expect(result.name).toBe("codex CLI");
    expect(spawnSyncMock).toHaveBeenCalledWith("codex", ["--version"], expect.any(Object));
  });

  it("codex-cli: returns fail when binary not found", async () => {
    spawnSyncMock.mockReturnValue({ status: 1, error: new Error("ENOENT") });
    const { checkProviderBinary } = await import("../../src/cli/doctor.js");
    const result = checkProviderBinary("codex-cli");
    expect(result.ok).toBe(false);
    expect(result.fix).toContain("npm install -g");
  });

  it("ollama: returns ok when ollama list exits 0", async () => {
    spawnSyncMock.mockReturnValue({ status: 0, error: null });
    const { checkProviderBinary } = await import("../../src/cli/doctor.js");
    const result = checkProviderBinary("ollama");
    expect(result.ok).toBe(true);
    expect(result.name).toBe("ollama");
    expect(spawnSyncMock).toHaveBeenCalledWith("ollama", ["list"], expect.any(Object));
  });

  it("openai-api: returns N/A (no binary required)", async () => {
    const { checkProviderBinary } = await import("../../src/cli/doctor.js");
    const result = checkProviderBinary("openai-api");
    expect(result.ok).toBe(true);
    expect(result.detail).toBe("N/A");
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// checkAuth
// ---------------------------------------------------------------------------

describe("checkAuth", () => {
  it("openai-api: ok when config.apiKey is set", async () => {
    const { checkAuth } = await import("../../src/cli/doctor.js");
    const result = checkAuth("openai-api", { apiKey: "sk-test" });
    expect(result.ok).toBe(true);
    expect(result.name).toBe("OpenAI API key");
  });

  it("openai-api: fails when no key in config or env", async () => {
    const { checkAuth } = await import("../../src/cli/doctor.js");
    const savedKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const result = checkAuth("openai-api", {});
    if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
    expect(result.ok).toBe(false);
    expect(result.fix).toContain("OPENAI_API_KEY");
  });

  it("anthropic: ok when config.anthropicApiKey is set", async () => {
    const { checkAuth } = await import("../../src/cli/doctor.js");
    const result = checkAuth("anthropic", { anthropicApiKey: "sk-ant-test" });
    expect(result.ok).toBe(true);
    expect(result.name).toBe("Anthropic API key");
  });

  it("openrouter: ok when config.openrouterApiKey is set", async () => {
    const { checkAuth } = await import("../../src/cli/doctor.js");
    const result = checkAuth("openrouter", { openrouterApiKey: "sk-or-test" });
    expect(result.ok).toBe(true);
    expect(result.name).toBe("OpenRouter API key");
  });

  it("openrouter: fails when no key available", async () => {
    const { checkAuth } = await import("../../src/cli/doctor.js");
    const savedKey = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    const result = checkAuth("openrouter", {});
    if (savedKey !== undefined) process.env.OPENROUTER_API_KEY = savedKey;
    expect(result.ok).toBe(false);
    expect(result.fix).toContain("OPENROUTER_API_KEY");
  });

  it("gemini: ok when config.geminiApiKey is set", async () => {
    const { checkAuth } = await import("../../src/cli/doctor.js");
    const result = checkAuth("gemini", { geminiApiKey: "AIzaTestKey" });
    expect(result.ok).toBe(true);
    expect(result.name).toBe("Gemini API key");
  });

  it("gemini: fails when no key in config or env", async () => {
    const { checkAuth } = await import("../../src/cli/doctor.js");
    const savedKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const result = checkAuth("gemini", {});
    if (savedKey !== undefined) process.env.GEMINI_API_KEY = savedKey;
    expect(result.ok).toBe(false);
    expect(result.fix).toContain("GEMINI_API_KEY");
  });

  it("ollama: always N/A (no auth required)", async () => {
    const { checkAuth } = await import("../../src/cli/doctor.js");
    const result = checkAuth("ollama", {});
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("N/A");
  });
});

// ---------------------------------------------------------------------------
// checkConfigFile
// ---------------------------------------------------------------------------

describe("checkConfigFile", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("ok when config file is absent (optional)", async () => {
    const { checkConfigFile } = await import("../../src/cli/doctor.js");
    const result = checkConfigFile(join(tmpDir, ".phase2s.yaml"));
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("not present");
  });

  it("ok when config has a valid provider", async () => {
    const { checkConfigFile } = await import("../../src/cli/doctor.js");
    const configPath = join(tmpDir, ".phase2s.yaml");
    writeFileSync(configPath, "provider: openai-api\n");
    const result = checkConfigFile(configPath);
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("openai-api");
  });

  it("fails when provider value is unknown", async () => {
    const { checkConfigFile } = await import("../../src/cli/doctor.js");
    const configPath = join(tmpDir, ".phase2s.yaml");
    writeFileSync(configPath, "provider: unknown-ai\n");
    const result = checkConfigFile(configPath);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("unknown-ai");
  });

  it("fails when YAML is malformed", async () => {
    const { checkConfigFile } = await import("../../src/cli/doctor.js");
    const configPath = join(tmpDir, ".phase2s.yaml");
    writeFileSync(configPath, "provider: [\nbad yaml\n");
    const result = checkConfigFile(configPath);
    expect(result.ok).toBe(false);
    expect(result.fix).toContain("phase2s init");
  });
});

// ---------------------------------------------------------------------------
// checkWorkDir
// ---------------------------------------------------------------------------

describe("checkWorkDir", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates missing dir and returns ok", async () => {
    const { checkWorkDir } = await import("../../src/cli/doctor.js");
    const targetDir = join(tmpDir, ".phase2s");
    const result = checkWorkDir(targetDir);
    expect(result.ok).toBe(true);
    expect(result.detail).toBe("writable");
  });

  it("returns ok when dir already exists and is writable", async () => {
    const { checkWorkDir } = await import("../../src/cli/doctor.js");
    const targetDir = join(tmpDir, ".phase2s");
    mkdirSync(targetDir);
    const result = checkWorkDir(targetDir);
    expect(result.ok).toBe(true);
  });
});
