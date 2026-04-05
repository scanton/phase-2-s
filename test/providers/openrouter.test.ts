import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Config } from "../../src/core/config.js";

// ---------------------------------------------------------------------------
// Mock OpenAI so no real HTTP calls are made.
// Track constructor args and the chat.completions.create mock.
// ---------------------------------------------------------------------------

const mockOpenAIInstances: Array<{
  _baseURL: string;
  _apiKey: string;
  _defaultHeaders: Record<string, string>;
}> = [];

const mockCreate = vi.fn().mockResolvedValue({
  [Symbol.asyncIterator]: async function* () { /* empty stream */ },
});

vi.mock("openai", () => {
  return {
    default: class MockOpenAI {
      _baseURL: string;
      _apiKey: string;
      _defaultHeaders: Record<string, string>;
      chat = { completions: { create: mockCreate } };
      constructor(opts: {
        baseURL: string;
        apiKey: string;
        defaultHeaders?: Record<string, string>;
      }) {
        this._baseURL = opts.baseURL;
        this._apiKey = opts.apiKey;
        this._defaultHeaders = opts.defaultHeaders ?? {};
        mockOpenAIInstances.push(this);
      }
    },
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    provider: "openrouter",
    model: "openai/gpt-4o",
    apiKey: undefined,
    anthropicApiKey: undefined,
    anthropicMaxTokens: undefined,
    ollamaBaseUrl: undefined,
    openrouterApiKey: "sk-or-test-key",
    openrouterBaseUrl: undefined,
    fast_model: undefined,
    smart_model: undefined,
    codexPath: "codex",
    systemPrompt: undefined,
    maxTurns: 50,
    timeout: 120_000,
    allowDestructive: false,
    verifyCommand: "npm test",
    requireSpecification: false,
    tools: undefined,
    deny: undefined,
    ...overrides,
  } as Config;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OpenRouterProvider", () => {
  beforeEach(() => {
    mockOpenAIInstances.length = 0;
    mockCreate.mockClear();
  });

  it("throws when no API key is provided and no client is injected", async () => {
    const { OpenRouterProvider } = await import("../../src/providers/openrouter.js");
    expect(() =>
      new OpenRouterProvider(makeConfig({ openrouterApiKey: undefined })),
    ).toThrow(/OpenRouter API key is required/i);
  });

  it("sets provider name to 'openrouter'", async () => {
    const { OpenRouterProvider } = await import("../../src/providers/openrouter.js");
    const provider = new OpenRouterProvider(makeConfig());
    expect(provider.name).toBe("openrouter");
  });

  it("uses the default OpenRouter base URL when openrouterBaseUrl is not set", async () => {
    const { OpenRouterProvider } = await import("../../src/providers/openrouter.js");
    new OpenRouterProvider(makeConfig({ openrouterBaseUrl: undefined }));
    expect(mockOpenAIInstances.length).toBeGreaterThan(0);
    const instance = mockOpenAIInstances[mockOpenAIInstances.length - 1];
    expect(instance._baseURL).toBe("https://openrouter.ai/api/v1");
  });

  it("respects a custom openrouterBaseUrl from config", async () => {
    const { OpenRouterProvider } = await import("../../src/providers/openrouter.js");
    new OpenRouterProvider(
      makeConfig({ openrouterBaseUrl: "https://custom.openrouter.example/v1" }),
    );
    expect(mockOpenAIInstances.length).toBeGreaterThan(0);
    const instance = mockOpenAIInstances[mockOpenAIInstances.length - 1];
    expect(instance._baseURL).toBe("https://custom.openrouter.example/v1");
  });

  it("injects HTTP-Referer and X-Title headers", async () => {
    const { OpenRouterProvider } = await import("../../src/providers/openrouter.js");
    new OpenRouterProvider(makeConfig());
    expect(mockOpenAIInstances.length).toBeGreaterThan(0);
    const instance = mockOpenAIInstances[mockOpenAIInstances.length - 1];
    expect(instance._defaultHeaders["HTTP-Referer"]).toContain("phase-2-s");
    expect(instance._defaultHeaders["X-Title"]).toBe("Phase2S");
  });

  it("accepts an injected client and skips the API key check", async () => {
    const { OpenRouterProvider } = await import("../../src/providers/openrouter.js");
    const fakeClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            [Symbol.asyncIterator]: async function* () {},
          }),
        },
      },
    };
    // No openrouterApiKey — should NOT throw because client is injected
    expect(() =>
      new OpenRouterProvider(
        makeConfig({ openrouterApiKey: undefined }),
        fakeClient as never,
      ),
    ).not.toThrow();
  });
});
