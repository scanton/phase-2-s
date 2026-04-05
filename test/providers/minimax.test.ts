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
    provider: "minimax",
    model: "MiniMax-M2.5",
    apiKey: undefined,
    anthropicApiKey: undefined,
    anthropicMaxTokens: undefined,
    ollamaBaseUrl: undefined,
    openrouterApiKey: undefined,
    openrouterBaseUrl: undefined,
    geminiApiKey: undefined,
    geminiBaseUrl: undefined,
    minimaxApiKey: "test-minimax-key-12345",
    minimaxBaseUrl: undefined,
    bear: true,
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

describe("MiniMaxProvider", () => {
  beforeEach(() => {
    mockOpenAIInstances.length = 0;
    mockCreate.mockClear();
    vi.resetModules();
  });

  it("throws when no API key is provided and no client is injected", async () => {
    const { MiniMaxProvider } = await import("../../src/providers/minimax.js");
    expect(() =>
      new MiniMaxProvider(makeConfig({ minimaxApiKey: undefined })),
    ).toThrow(/MiniMax API key is required/i);
  });

  it("sets provider name to 'minimax'", async () => {
    const { MiniMaxProvider } = await import("../../src/providers/minimax.js");
    const provider = new MiniMaxProvider(makeConfig());
    expect(provider.name).toBe("minimax");
  });

  it("uses the default MiniMax base URL when minimaxBaseUrl is not set", async () => {
    const { MiniMaxProvider } = await import("../../src/providers/minimax.js");
    const before = mockOpenAIInstances.length;
    new MiniMaxProvider(makeConfig({ minimaxBaseUrl: undefined }));
    expect(mockOpenAIInstances.length).toBeGreaterThan(before);
    const instance = mockOpenAIInstances[mockOpenAIInstances.length - 1];
    expect(instance._baseURL).toBe("https://api.minimax.io/v1/");
  });

  it("respects a custom minimaxBaseUrl from config", async () => {
    const { MiniMaxProvider } = await import("../../src/providers/minimax.js");
    const before = mockOpenAIInstances.length;
    new MiniMaxProvider(
      makeConfig({ minimaxBaseUrl: "https://custom.minimax.example/v1/" }),
    );
    expect(mockOpenAIInstances.length).toBeGreaterThan(before);
    const instance = mockOpenAIInstances[mockOpenAIInstances.length - 1];
    expect(instance._baseURL).toBe("https://custom.minimax.example/v1/");
  });

  it("adds a trailing slash to minimaxBaseUrl if missing", async () => {
    const { MiniMaxProvider } = await import("../../src/providers/minimax.js");
    const before = mockOpenAIInstances.length;
    new MiniMaxProvider(
      makeConfig({ minimaxBaseUrl: "https://custom.minimax.example/v1" }),
    );
    expect(mockOpenAIInstances.length).toBeGreaterThan(before);
    const instance = mockOpenAIInstances[mockOpenAIInstances.length - 1];
    expect(instance._baseURL).toBe("https://custom.minimax.example/v1/");
  });

  it("accepts an injected client and skips the API key check", async () => {
    const { MiniMaxProvider } = await import("../../src/providers/minimax.js");
    const fakeClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            [Symbol.asyncIterator]: async function* () {},
          }),
        },
      },
    };
    // No minimaxApiKey — should NOT throw because client is injected
    expect(() =>
      new MiniMaxProvider(
        makeConfig({ minimaxApiKey: undefined }),
        fakeClient as never,
      ),
    ).not.toThrow();
  });
});
