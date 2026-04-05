import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { formatConfig, checkPrerequisites, readExistingConfig } from "../../src/cli/init.js";
import type { InitConfig } from "../../src/cli/init.js";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Mock child_process so codex/ollama binary checks never run real processes
// ---------------------------------------------------------------------------

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn().mockReturnValue({ status: 0, error: null }),
}));

// ---------------------------------------------------------------------------
// formatConfig
// ---------------------------------------------------------------------------

describe("formatConfig", () => {
  it("codex-cli: no API key in output", () => {
    const yaml = formatConfig({ provider: "codex-cli" });
    expect(yaml).toContain("provider: codex-cli");
    expect(yaml).not.toContain("apiKey");
    expect(yaml).not.toContain("anthropicApiKey");
  });

  it("openai-api: includes apiKey line", () => {
    const yaml = formatConfig({ provider: "openai-api", apiKey: "sk-test123" });
    expect(yaml).toContain('apiKey: "sk-test123"');
    expect(yaml).not.toContain("anthropicApiKey");
  });

  it("anthropic: includes anthropicApiKey line", () => {
    const yaml = formatConfig({ provider: "anthropic", apiKey: "sk-ant-test" });
    expect(yaml).toContain('anthropicApiKey: "sk-ant-test"');
    expect(yaml).not.toContain('apiKey: "sk-ant-test"');
  });

  it("model tiers: included when both set", () => {
    const yaml = formatConfig({
      provider: "codex-cli",
      fastModel: "gpt-4o-mini",
      smartModel: "o3",
    });
    expect(yaml).toContain("fast_model: gpt-4o-mini");
    expect(yaml).toContain("smart_model: o3");
  });

  it("model tiers: partially set (only fast_model)", () => {
    const yaml = formatConfig({ provider: "openai-api", fastModel: "gpt-4o-mini" });
    expect(yaml).toContain("fast_model: gpt-4o-mini");
    expect(yaml).not.toContain("smart_model");
  });

  it("slackWebhook: included in notify block when set", () => {
    const yaml = formatConfig({
      provider: "codex-cli",
      slackWebhook: "https://hooks.slack.com/test",
    });
    expect(yaml).toContain("notify:");
    expect(yaml).toContain('slack: "https://hooks.slack.com/test"');
  });

  it("slackWebhook: not included when absent", () => {
    const yaml = formatConfig({ provider: "codex-cli" });
    expect(yaml).not.toContain("notify:");
    expect(yaml).not.toContain("slack:");
  });

  it("discordWebhook: included in notify block when set", () => {
    const yaml = formatConfig({
      provider: "codex-cli",
      discordWebhook: "https://discord.com/api/webhooks/abc/xyz",
    });
    expect(yaml).toContain("notify:");
    expect(yaml).toContain('discord: "https://discord.com/api/webhooks/abc/xyz"');
  });

  it("teamsWebhook: included in notify block when set", () => {
    const yaml = formatConfig({
      provider: "codex-cli",
      teamsWebhook: "https://outlook.office.com/webhook/abc",
    });
    expect(yaml).toContain("notify:");
    expect(yaml).toContain('teams: "https://outlook.office.com/webhook/abc"');
  });

  it("all three webhooks set: all appear in notify block", () => {
    const yaml = formatConfig({
      provider: "codex-cli",
      slackWebhook: "https://hooks.slack.com/test",
      discordWebhook: "https://discord.com/api/webhooks/test",
      teamsWebhook: "https://outlook.office.com/webhook/test",
    });
    expect(yaml).toContain('slack: "https://hooks.slack.com/test"');
    expect(yaml).toContain('discord: "https://discord.com/api/webhooks/test"');
    expect(yaml).toContain('teams: "https://outlook.office.com/webhook/test"');
  });

  it("always ends with newline", () => {
    const yaml = formatConfig({ provider: "ollama" });
    expect(yaml.endsWith("\n")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// checkPrerequisites
// ---------------------------------------------------------------------------

describe("checkPrerequisites", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("codex-cli: ok when binary found (mocked spawnSync success)", async () => {
    const { spawnSync } = await import("node:child_process");
    const spy = spawnSync as ReturnType<typeof vi.fn>;
    spy.mockReturnValueOnce({ status: 0, error: null });

    const result = checkPrerequisites({ provider: "codex-cli" });
    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it("codex-cli: warning when binary not found", async () => {
    const { spawnSync } = await import("node:child_process");
    const spy = spawnSync as ReturnType<typeof vi.fn>;
    spy.mockReturnValueOnce({ error: new Error("not found") });

    const result = checkPrerequisites({ provider: "codex-cli" });
    expect(result.ok).toBe(false);
    expect(result.warnings[0]).toContain("codex CLI not found");
  });

  it("openai-api: warning when key doesn't start with sk-", () => {
    const result = checkPrerequisites({ provider: "openai-api", apiKey: "bad-key" });
    expect(result.ok).toBe(false);
    expect(result.warnings[0]).toContain("should start with 'sk-'");
  });

  it("openai-api: ok when key starts with sk-", () => {
    const result = checkPrerequisites({ provider: "openai-api", apiKey: "sk-abc123" });
    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it("anthropic: warning when key doesn't start with sk-ant-", () => {
    const result = checkPrerequisites({ provider: "anthropic", apiKey: "sk-not-anthropic" });
    expect(result.ok).toBe(false);
    expect(result.warnings[0]).toContain("should start with 'sk-ant-'");
  });

  it("anthropic: ok when key starts with sk-ant-", () => {
    const result = checkPrerequisites({ provider: "anthropic", apiKey: "sk-ant-valid" });
    expect(result.ok).toBe(true);
  });

  it("anthropic: warning when no key and no env var", () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const result = checkPrerequisites({ provider: "anthropic" });
    expect(result.warnings.some((w) => w.includes("ANTHROPIC_API_KEY"))).toBe(true);
    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
  });

  it("ollama: warning when binary not found", async () => {
    const { spawnSync } = await import("node:child_process");
    const spy = spawnSync as ReturnType<typeof vi.fn>;
    spy.mockReturnValueOnce({ error: new Error("not found") });

    const result = checkPrerequisites({ provider: "ollama" });
    expect(result.ok).toBe(false);
    expect(result.warnings[0]).toContain("ollama not found");
  });

  it("gemini: warning when key doesn't start with AIza", () => {
    const result = checkPrerequisites({ provider: "gemini", geminiApiKey: "bad-key" });
    expect(result.ok).toBe(false);
    expect(result.warnings[0]).toContain("should start with 'AIza'");
  });

  it("gemini: ok when key starts with AIza", () => {
    const result = checkPrerequisites({ provider: "gemini", geminiApiKey: "AIzaTestKey" });
    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// formatConfig Gemini
// ---------------------------------------------------------------------------

describe("formatConfig (gemini)", () => {
  it("includes geminiApiKey line and helpful comment", () => {
    const yaml = formatConfig({ provider: "gemini", geminiApiKey: "AIzaTestKey" });
    expect(yaml).toContain('geminiApiKey: "AIzaTestKey"');
    expect(yaml).toContain("aistudio.google.com/apikey");
  });

  it("no geminiApiKey in output when absent", () => {
    const yaml = formatConfig({ provider: "gemini" });
    expect(yaml).not.toContain("geminiApiKey");
  });
});

// ---------------------------------------------------------------------------
// readExistingConfig
// ---------------------------------------------------------------------------

describe("readExistingConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "phase2s-init-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns parsed object when file exists", () => {
    const configPath = join(tmpDir, ".phase2s.yaml");
    writeFileSync(configPath, "provider: openai-api\napiKey: sk-test\n", "utf8");
    const result = readExistingConfig(configPath);
    expect(result.provider).toBe("openai-api");
    expect(result.apiKey).toBe("sk-test");
  });

  it("returns empty object when file does not exist", () => {
    const result = readExistingConfig(join(tmpDir, "nonexistent.yaml"));
    expect(result).toEqual({});
  });

  it("returns empty object when file contains invalid yaml", () => {
    const configPath = join(tmpDir, "bad.yaml");
    writeFileSync(configPath, "{ not: yaml: at: all", "utf8");
    const result = readExistingConfig(configPath);
    expect(result).toEqual({});
  });

  it("returns empty object when file contains a non-object (e.g. a list)", () => {
    const configPath = join(tmpDir, "list.yaml");
    writeFileSync(configPath, "- item1\n- item2\n", "utf8");
    const result = readExistingConfig(configPath);
    expect(result).toEqual({});
  });
});
