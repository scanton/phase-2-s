import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Config } from "../../src/core/config.js";

// ---------------------------------------------------------------------------
// Mock the OpenAI constructor so we can verify baseURL/apiKey injection
// without a real Ollama server. The mock must be a class (not arrow fn).
// ---------------------------------------------------------------------------

const mockOpenAIInstances: Array<{ _baseURL: string; _apiKey: string }> = [];

vi.mock("openai", () => {
  return {
    default: class MockOpenAI {
      _baseURL: string;
      _apiKey: string;
      chat = { completions: { create: vi.fn() } };
      constructor(opts: { baseURL: string; apiKey: string }) {
        this._baseURL = opts.baseURL;
        this._apiKey = opts.apiKey;
        mockOpenAIInstances.push(this);
      }
    },
  };
});

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    provider: "ollama",
    model: "llama3.1:8b",
    apiKey: undefined,
    anthropicApiKey: undefined,
    anthropicMaxTokens: undefined,
    ollamaBaseUrl: undefined,
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

describe("createOllamaProvider", () => {
  beforeEach(() => {
    mockOpenAIInstances.length = 0;
  });

  it("sets provider name to 'ollama'", async () => {
    const { createOllamaProvider } = await import("../../src/providers/ollama.js");
    const provider = createOllamaProvider(makeConfig());
    expect(provider.name).toBe("ollama");
  });

  it("uses default Ollama base URL when ollamaBaseUrl is not set", async () => {
    const { createOllamaProvider } = await import("../../src/providers/ollama.js");
    createOllamaProvider(makeConfig({ ollamaBaseUrl: undefined }));
    expect(mockOpenAIInstances.length).toBeGreaterThan(0);
    expect(mockOpenAIInstances[mockOpenAIInstances.length - 1]._baseURL).toBe(
      "http://localhost:11434/v1",
    );
  });

  it("uses custom ollamaBaseUrl from config when provided", async () => {
    const { createOllamaProvider } = await import("../../src/providers/ollama.js");
    createOllamaProvider(makeConfig({ ollamaBaseUrl: "http://192.168.1.50:11434/v1" }));
    expect(mockOpenAIInstances.length).toBeGreaterThan(0);
    expect(mockOpenAIInstances[mockOpenAIInstances.length - 1]._baseURL).toBe(
      "http://192.168.1.50:11434/v1",
    );
  });

  it("passes 'ollama' as the API key (Ollama accepts any non-empty string)", async () => {
    const { createOllamaProvider } = await import("../../src/providers/ollama.js");
    createOllamaProvider(makeConfig());
    expect(mockOpenAIInstances.length).toBeGreaterThan(0);
    expect(mockOpenAIInstances[mockOpenAIInstances.length - 1]._apiKey).toBe("ollama");
  });
});
