import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Config } from "../../src/core/config.js";

// ---------------------------------------------------------------------------
// Mock OpenAI so no real HTTP calls are made.
// Track constructor args.
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
    provider: "gemini",
    model: "gemini-2.0-flash",
    apiKey: undefined,
    anthropicApiKey: undefined,
    anthropicMaxTokens: undefined,
    ollamaBaseUrl: undefined,
    openrouterApiKey: undefined,
    openrouterBaseUrl: undefined,
    geminiApiKey: "AIzaTestKey12345",
    geminiBaseUrl: undefined,
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

describe("GeminiProvider", () => {
  beforeEach(() => {
    mockOpenAIInstances.length = 0;
    mockCreate.mockClear();
  });

  it("throws when no API key is provided and no client is injected", async () => {
    const { GeminiProvider } = await import("../../src/providers/gemini.js");
    expect(() =>
      new GeminiProvider(makeConfig({ geminiApiKey: undefined })),
    ).toThrow(/Gemini API key is required/i);
  });

  it("sets provider name to 'gemini'", async () => {
    const { GeminiProvider } = await import("../../src/providers/gemini.js");
    const provider = new GeminiProvider(makeConfig());
    expect(provider.name).toBe("gemini");
  });

  it("uses the default Gemini base URL when geminiBaseUrl is not set", async () => {
    const { GeminiProvider } = await import("../../src/providers/gemini.js");
    new GeminiProvider(makeConfig({ geminiBaseUrl: undefined }));
    expect(mockOpenAIInstances.length).toBeGreaterThan(0);
    const instance = mockOpenAIInstances[mockOpenAIInstances.length - 1];
    expect(instance._baseURL).toBe("https://generativelanguage.googleapis.com/v1beta/openai/");
  });

  it("respects a custom geminiBaseUrl from config", async () => {
    const { GeminiProvider } = await import("../../src/providers/gemini.js");
    new GeminiProvider(
      makeConfig({ geminiBaseUrl: "https://custom.gemini.example/v1/" }),
    );
    expect(mockOpenAIInstances.length).toBeGreaterThan(0);
    const instance = mockOpenAIInstances[mockOpenAIInstances.length - 1];
    expect(instance._baseURL).toBe("https://custom.gemini.example/v1/");
  });

  it("adds a trailing slash to geminiBaseUrl if missing", async () => {
    const { GeminiProvider } = await import("../../src/providers/gemini.js");
    new GeminiProvider(
      makeConfig({ geminiBaseUrl: "https://custom.gemini.example/v1" }),
    );
    expect(mockOpenAIInstances.length).toBeGreaterThan(0);
    const instance = mockOpenAIInstances[mockOpenAIInstances.length - 1];
    expect(instance._baseURL).toBe("https://custom.gemini.example/v1/");
  });

  it("does NOT inject extra headers (unlike OpenRouter)", async () => {
    const { GeminiProvider } = await import("../../src/providers/gemini.js");
    new GeminiProvider(makeConfig());
    expect(mockOpenAIInstances.length).toBeGreaterThan(0);
    const instance = mockOpenAIInstances[mockOpenAIInstances.length - 1];
    // Gemini uses the standard OpenAI client with no custom default headers
    expect(instance._defaultHeaders["HTTP-Referer"]).toBeUndefined();
    expect(instance._defaultHeaders["X-Title"]).toBeUndefined();
  });

  it("accepts an injected client and skips the API key check", async () => {
    const { GeminiProvider } = await import("../../src/providers/gemini.js");
    const fakeClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            [Symbol.asyncIterator]: async function* () {},
          }),
        },
      },
    };
    // No geminiApiKey — should NOT throw because client is injected
    expect(() =>
      new GeminiProvider(
        makeConfig({ geminiApiKey: undefined }),
        fakeClient as never,
      ),
    ).not.toThrow();
  });
});
