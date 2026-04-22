import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../../src/core/config.js";

/**
 * Config tests focus on override precedence and default values.
 * We don't test YAML file loading here (would require temp files) — that's
 * covered by integration tests. We test the config schema and env var wiring.
 *
 * HOME is overridden to /tmp so resolveDefaultModel() never reads the real
 * ~/.codex/config.toml — results are deterministic on any machine.
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
    // Isolate from ~/.codex/config.toml so model defaults are deterministic
    process.env.HOME = "/tmp";
    process.env.USERPROFILE = "/tmp";
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

  it("defaults to gpt-4o when no codex config exists (HOME=/tmp)", async () => {
    // HOME is /tmp in beforeEach — no ~/.codex/config.toml there
    const config = await loadConfig({});
    expect(config.model).toBe("gpt-4o");
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

  // --- allowDestructive ---

  it("defaults allowDestructive to false", async () => {
    const config = await loadConfig({});
    expect(config.allowDestructive).toBe(false);
  });

  it("parses allowDestructive: true from overrides", async () => {
    const config = await loadConfig({ allowDestructive: true });
    expect(config.allowDestructive).toBe(true);
  });

  it("PHASE2S_ALLOW_DESTRUCTIVE=true env var sets allowDestructive", async () => {
    const orig = process.env.PHASE2S_ALLOW_DESTRUCTIVE;
    process.env.PHASE2S_ALLOW_DESTRUCTIVE = "true";
    try {
      const config = await loadConfig({});
      expect(config.allowDestructive).toBe(true);
    } finally {
      if (orig === undefined) delete process.env.PHASE2S_ALLOW_DESTRUCTIVE;
      else process.env.PHASE2S_ALLOW_DESTRUCTIVE = orig;
    }
  });

  it("PHASE2S_ALLOW_DESTRUCTIVE accepts '1' and 'yes' (truthy variants)", async () => {
    const orig = process.env.PHASE2S_ALLOW_DESTRUCTIVE;
    for (const val of ["1", "yes", "YES", "True"]) {
      process.env.PHASE2S_ALLOW_DESTRUCTIVE = val;
      const config = await loadConfig({});
      expect(config.allowDestructive).toBe(true);
    }
    process.env.PHASE2S_ALLOW_DESTRUCTIVE = "false";
    const configFalse = await loadConfig({});
    expect(configFalse.allowDestructive).toBe(false);
    if (orig === undefined) delete process.env.PHASE2S_ALLOW_DESTRUCTIVE;
    else process.env.PHASE2S_ALLOW_DESTRUCTIVE = orig;
  });
});

describe("loadConfig — Sprint 8 fields", () => {
  let origEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    origEnv = { ...process.env };
    delete process.env.PHASE2S_FAST_MODEL;
    delete process.env.PHASE2S_SMART_MODEL;
    delete process.env.PHASE2S_VERIFY_COMMAND;
    process.env.HOME = "/tmp";
    process.env.USERPROFILE = "/tmp";
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in origEnv)) delete process.env[key];
    }
    Object.assign(process.env, origEnv);
  });

  it("fast_model and smart_model parse from env vars", async () => {
    process.env.PHASE2S_FAST_MODEL = "gpt-4o-mini";
    process.env.PHASE2S_SMART_MODEL = "o3";
    const config = await loadConfig();
    expect(config.fast_model).toBe("gpt-4o-mini");
    expect(config.smart_model).toBe("o3");
  });

  it("verifyCommand defaults to 'npm test'", async () => {
    const config = await loadConfig();
    expect(config.verifyCommand).toBe("npm test");
  });

  it("requireSpecification defaults to false", async () => {
    const config = await loadConfig();
    expect(config.requireSpecification).toBe(false);
  });

  it("PHASE2S_VERIFY_COMMAND env var overrides verifyCommand", async () => {
    process.env.PHASE2S_VERIFY_COMMAND = "vitest run";
    const config = await loadConfig();
    expect(config.verifyCommand).toBe("vitest run");
  });
});

describe("loadConfig — tools and deny (Sprint 13)", () => {
  beforeEach(() => {
    process.env.HOME = "/tmp";
    process.env.USERPROFILE = "/tmp";
  });

  it("tools defaults to undefined (no allow-list)", async () => {
    const config = await loadConfig({});
    expect(config.tools).toBeUndefined();
  });

  it("deny defaults to undefined (no deny-list)", async () => {
    const config = await loadConfig({});
    expect(config.deny).toBeUndefined();
  });

  it("tools: array is accepted as an override", async () => {
    const config = await loadConfig({ tools: ["file_read", "shell"] });
    expect(config.tools).toEqual(["file_read", "shell"]);
  });

  it("deny: array is accepted as an override", async () => {
    const config = await loadConfig({ deny: ["shell"] });
    expect(config.deny).toEqual(["shell"]);
  });

  // --- New providers (Sprint 14) ---

  it("accepts provider: 'anthropic' and resolves default model", async () => {
    const config = await loadConfig({ provider: "anthropic" });
    expect(config.provider).toBe("anthropic");
    expect(config.model).toBe("claude-3-5-sonnet-20241022");
  });

  it("accepts provider: 'ollama' with custom ollamaBaseUrl", async () => {
    const config = await loadConfig({
      provider: "ollama",
      ollamaBaseUrl: "http://192.168.1.50:11434/v1",
    });
    expect(config.provider).toBe("ollama");
    expect(config.ollamaBaseUrl).toBe("http://192.168.1.50:11434/v1");
    expect(config.model).toBe("llama3.1:8b");
  });

  // --- auto_compact_tokens (Sprint 55) ---

  it("auto_compact_tokens: positive integer is accepted", async () => {
    const config = await loadConfig({ auto_compact_tokens: 80_000 });
    expect(config.auto_compact_tokens).toBe(80_000);
  });

  it("auto_compact_tokens: 0 is rejected (must be >= 1 or unset to disable)", async () => {
    await expect(loadConfig({ auto_compact_tokens: 0 } as never)).rejects.toThrow();
  });

  it("auto_compact_tokens: unset means undefined (disabled)", async () => {
    const config = await loadConfig({});
    expect(config.auto_compact_tokens).toBeUndefined();
  });

  it("auto_compact_tokens: negative integer is rejected by schema", async () => {
    await expect(loadConfig({ auto_compact_tokens: -1 } as never)).rejects.toThrow();
  });

  // --- rate_limit_backoff_threshold (Sprint 58) ---

  it("rate_limit_backoff_threshold: defaults to 60 when unset", async () => {
    const config = await loadConfig({});
    expect(config.rate_limit_backoff_threshold).toBe(60);
  });

  it("rate_limit_backoff_threshold: explicit value is accepted", async () => {
    const config = await loadConfig({ rate_limit_backoff_threshold: 30 });
    expect(config.rate_limit_backoff_threshold).toBe(30);
  });

  it("rate_limit_backoff_threshold: 0 is accepted (disables auto-backoff)", async () => {
    const config = await loadConfig({ rate_limit_backoff_threshold: 0 });
    expect(config.rate_limit_backoff_threshold).toBe(0);
  });

  it("rate_limit_backoff_threshold: negative value is rejected by schema", async () => {
    await expect(loadConfig({ rate_limit_backoff_threshold: -1 } as never)).rejects.toThrow();
  });

  // --- max_auto_compact_count (Sprint 61) ---

  it("max_auto_compact_count: positive integer is accepted", async () => {
    const config = await loadConfig({ max_auto_compact_count: 5 });
    expect(config.max_auto_compact_count).toBe(5);
  });

  it("max_auto_compact_count: 1 is accepted (minimum valid value)", async () => {
    const config = await loadConfig({ max_auto_compact_count: 1 });
    expect(config.max_auto_compact_count).toBe(1);
  });

  it("max_auto_compact_count: 0 is rejected (min is 1)", async () => {
    await expect(loadConfig({ max_auto_compact_count: 0 } as never)).rejects.toThrow();
  });

  it("max_auto_compact_count: unset means undefined (no cap — falls back to hardcoded default 3 in maybeAutoCompact)", async () => {
    const config = await loadConfig({});
    expect(config.max_auto_compact_count).toBeUndefined();
  });
});
