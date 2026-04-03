import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadConfig } from "../../src/core/config.js";

/**
 * Config tests focus on override precedence and default values.
 * We don't test YAML file loading here (would require temp files) — that's
 * covered by integration tests. We test the config schema and env var wiring.
 */
describe("loadConfig", () => {
  // Snapshot the original env so we restore it cleanly
  let origEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    origEnv = { ...process.env };
    // Clear phase2s-specific env vars before each test
    delete process.env.OPENAI_API_KEY;
    delete process.env.PHASE2S_PROVIDER;
    delete process.env.PHASE2S_MODEL;
    delete process.env.PHASE2S_CODEX_PATH;
  });

  afterEach(() => {
    // Restore original env
    for (const key of Object.keys(process.env)) {
      if (!(key in origEnv)) delete process.env[key];
    }
    Object.assign(process.env, origEnv);
  });

  // --- Defaults ---

  it("defaults to codex-cli provider", async () => {
    const config = await loadConfig({});
    expect(config.provider).toBe("codex-cli");
  });

  it("defaults codexPath to 'codex'", async () => {
    const config = await loadConfig({});
    expect(config.codexPath).toBe("codex");
  });

  it("defaults maxTurns to 50", async () => {
    const config = await loadConfig({});
    expect(config.maxTurns).toBe(50);
  });

  it("defaults timeout to 120000ms", async () => {
    const config = await loadConfig({});
    expect(config.timeout).toBe(120_000);
  });

  it("returns a model string (never undefined)", async () => {
    const config = await loadConfig({});
    expect(typeof config.model).toBe("string");
    expect(config.model.length).toBeGreaterThan(0);
  });

  // --- Env var overrides ---

  it("reads OPENAI_API_KEY from environment", async () => {
    process.env.OPENAI_API_KEY = "sk-test-key";
    const config = await loadConfig({});
    expect(config.apiKey).toBe("sk-test-key");
  });

  it("reads PHASE2S_PROVIDER from environment", async () => {
    process.env.PHASE2S_PROVIDER = "openai-api";
    const config = await loadConfig({});
    expect(config.provider).toBe("openai-api");
  });

  it("reads PHASE2S_MODEL from environment", async () => {
    process.env.PHASE2S_MODEL = "gpt-4-turbo";
    const config = await loadConfig({});
    expect(config.model).toBe("gpt-4-turbo");
  });

  it("reads PHASE2S_CODEX_PATH from environment", async () => {
    process.env.PHASE2S_CODEX_PATH = "/usr/local/bin/codex";
    const config = await loadConfig({});
    expect(config.codexPath).toBe("/usr/local/bin/codex");
  });

  // --- Override precedence: overrides > env > file ---

  it("overrides beat environment variables", async () => {
    process.env.PHASE2S_MODEL = "gpt-4-turbo";
    const config = await loadConfig({ model: "o3-mini" });
    expect(config.model).toBe("o3-mini");
  });

  it("overrides beat provider default", async () => {
    const config = await loadConfig({ provider: "openai-api", codexPath: "/custom/codex" });
    expect(config.provider).toBe("openai-api");
    expect(config.codexPath).toBe("/custom/codex");
  });

  // --- Schema validation ---

  it("rejects an invalid provider string", async () => {
    await expect(loadConfig({ provider: "invalid-provider" as never })).rejects.toThrow();
  });
});
