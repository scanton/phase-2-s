/**
 * Integration tests for Sprint 82: Code-RAG / code context injection.
 *
 * Tests the refreshAgentContext() helper and its wiring into the CLI.
 * All heavy I/O is mocked — no Ollama, no real files.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Conversation } from "../../src/core/conversation.js";
import { Agent } from "../../src/core/agent.js";
import { OpenAIProvider, type OpenAIClientLike } from "../../src/providers/openai.js";
import type { Config } from "../../src/core/config.js";
import type { ChatCompletionChunk } from "openai/resources/chat/completions.js";
import { refreshAgentContext } from "../../src/cli/index.js";
import type { CodeSearchResult } from "../../src/core/code-index.js";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("../../src/core/embeddings.js", () => ({
  generateEmbedding: vi.fn(),
}));

vi.mock("../../src/core/code-index.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../src/core/code-index.js")>();
  return {
    ...orig,
    searchCode: vi.fn(),
  };
});

vi.mock("../../src/core/memory.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../src/core/memory.js")>();
  return {
    ...orig,
    loadRelevantLearnings: vi.fn().mockResolvedValue([]),
    formatLearningsForPrompt: vi.fn().mockReturnValue(""),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { generateEmbedding } from "../../src/core/embeddings.js";
import { searchCode } from "../../src/core/code-index.js";
import { loadRelevantLearnings } from "../../src/core/memory.js";

const mockGenerateEmbedding = generateEmbedding as ReturnType<typeof vi.fn>;
const mockSearchCode = searchCode as ReturnType<typeof vi.fn>;
const mockLoadRelevantLearnings = loadRelevantLearnings as ReturnType<typeof vi.fn>;

function makeChunks(text: string): ChatCompletionChunk[] {
  const base = { id: "x", object: "chat.completion.chunk" as const, created: 0, model: "gpt-4o" };
  return [
    { ...base, choices: [{ index: 0, delta: { content: text }, finish_reason: null, logprobs: null }] },
    { ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" as const, logprobs: null }] },
  ];
}

function makeStreamingClient(): OpenAIClientLike {
  return {
    chat: {
      completions: {
        create: vi.fn().mockImplementation(() =>
          Promise.resolve((async function* () { yield* makeChunks("ok"); })()),
        ),
      },
    },
  };
}

const baseConfig: Config = {
  provider: "openai-api",
  model: "gpt-4o",
  apiKey: "sk-test",
  codexPath: "codex",
  maxTurns: 5,
  timeout: 120_000,
  allowDestructive: false,
  verifyCommand: "npm test",
  requireSpecification: false,
  ollamaBaseUrl: "http://localhost:11434",
  ollamaEmbedModel: "nomic-embed-text",
};

const configNoRag: Config = { ...baseConfig, codeRag: false };
const configNoOllama: Config = { ...baseConfig, ollamaBaseUrl: undefined };

function makeAgent(cfg: Config = baseConfig): Agent {
  const provider = new OpenAIProvider(cfg, makeStreamingClient());
  return new Agent({ config: cfg, provider });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadRelevantLearnings.mockResolvedValue([]);
});

describe("refreshAgentContext — config.codeRag === false", () => {
  it("calls refreshCodeContext(null) and does NOT call generateEmbedding for code path", async () => {
    mockGenerateEmbedding.mockResolvedValue([]);
    const agent = makeAgent(configNoRag);
    const spy = vi.spyOn(agent, "refreshCodeContext");
    await refreshAgentContext(agent, "find auth logic", configNoRag);
    expect(spy).toHaveBeenCalledWith(null);
    // generateEmbedding may or may not be called for learnings, but searchCode must not be called
    expect(mockSearchCode).not.toHaveBeenCalled();
  });
});

describe("refreshAgentContext — ollamaBaseUrl not configured", () => {
  it("queryVector is undefined; calls refreshCodeContext(null)", async () => {
    const agent = makeAgent(configNoOllama);
    const spy = vi.spyOn(agent, "refreshCodeContext");
    await refreshAgentContext(agent, "find auth logic", configNoOllama);
    expect(spy).toHaveBeenCalledWith(null);
    expect(mockGenerateEmbedding).not.toHaveBeenCalled();
    expect(mockSearchCode).not.toHaveBeenCalled();
  });
});

describe("refreshAgentContext — single embed call per turn", () => {
  it("generateEmbedding is called exactly once when both learnings and code-rag are active", async () => {
    const fakeVector = [0.1, 0.2, 0.3];
    mockGenerateEmbedding.mockResolvedValue(fakeVector);
    const mockResult: CodeSearchResult = {
      path: "src/auth.ts",
      score: 0.9,
      snippet: "export function auth() {}",
    };
    mockSearchCode.mockResolvedValue([mockResult]);

    const agent = makeAgent(baseConfig);
    vi.spyOn(agent, "refreshCodeContext");
    await refreshAgentContext(agent, "find authentication logic", baseConfig);

    // generateEmbedding called exactly once (shared for learnings + code-rag)
    expect(mockGenerateEmbedding).toHaveBeenCalledTimes(1);
  });
});

describe("refreshAgentContext — Ollama down (generateEmbedding rejects)", () => {
  it("queryVector = []; refreshCodeContext(null) called; no throw", async () => {
    mockGenerateEmbedding.mockRejectedValue(new Error("connection refused"));
    const agent = makeAgent(baseConfig);
    const spy = vi.spyOn(agent, "refreshCodeContext");
    await expect(refreshAgentContext(agent, "find the auth handler", baseConfig)).resolves.not.toThrow();
    expect(spy).toHaveBeenCalledWith(null);
    expect(mockSearchCode).not.toHaveBeenCalled();
  });
});

describe("refreshAgentContext — results above threshold", () => {
  it("calls refreshCodeContext(block) where block is non-null", async () => {
    const fakeVector = [0.5, 0.5, 0.5];
    mockGenerateEmbedding.mockResolvedValue(fakeVector);
    const mockResult: CodeSearchResult = {
      path: "src/core/auth.ts",
      chunkName: "authenticate",
      score: 0.85,
      snippet: "export function authenticate() {}",
    };
    mockSearchCode.mockResolvedValue([mockResult]);

    const agent = makeAgent(baseConfig);
    const spy = vi.spyOn(agent, "refreshCodeContext");
    await refreshAgentContext(agent, "authenticate the user session", baseConfig);

    expect(spy).toHaveBeenCalledOnce();
    const arg = spy.mock.calls[0][0];
    expect(arg).not.toBeNull();
    expect(typeof arg).toBe("string");
    expect(arg).toContain("auth.ts");
  });
});

describe("refreshAgentContext — all results below threshold", () => {
  it("calls refreshCodeContext(null)", async () => {
    const fakeVector = [0.1, 0.2, 0.3];
    mockGenerateEmbedding.mockResolvedValue(fakeVector);
    // searchCode already filters by score — empty results means nothing above threshold
    mockSearchCode.mockResolvedValue([]);

    const agent = makeAgent(baseConfig);
    const spy = vi.spyOn(agent, "refreshCodeContext");
    await refreshAgentContext(agent, "search the code base", baseConfig);
    expect(spy).toHaveBeenCalledWith(null);
  });
});

describe("saveSession — CODE_CONTEXT_MARKER filtered from saved messages", () => {
  it("does not retain [PHASE2S_CODE_CONTEXT] markers after filtering", () => {
    const c = new Conversation("system");
    c.addUser("question");
    c.upsertCodeContextMessage(`${Conversation.CODE_CONTEXT_MARKER}\nsome code`);

    const filtered = Conversation.fromMessages(
      c.getMessages().filter(
        (m) => !(
          m.role === "user" && (
            (m.content ?? "").startsWith(Conversation.LEARNINGS_MARKER) ||
            (m.content ?? "").startsWith(Conversation.CODE_CONTEXT_MARKER)
          )
        ),
      ),
    );
    const msgs = filtered.getMessages();
    expect(msgs.some((m) => (m.content ?? "").startsWith(Conversation.CODE_CONTEXT_MARKER))).toBe(false);
    // Original user message is preserved
    expect(msgs.some((m) => m.content === "question")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Sprint 83 — Item 2: Trivial turn skip
// ---------------------------------------------------------------------------

describe("refreshAgentContext — trivial input skip", () => {
  it("does NOT call generateEmbedding when input is 'yes' (trivial)", async () => {
    const agent = makeAgent(baseConfig);
    await refreshAgentContext(agent, "yes", baseConfig);
    expect(mockGenerateEmbedding).not.toHaveBeenCalled();
  });

  it("does NOT call searchCode when input is trivial", async () => {
    const agent = makeAgent(baseConfig);
    await refreshAgentContext(agent, "ok", baseConfig);
    expect(mockSearchCode).not.toHaveBeenCalled();
  });

  it("does NOT change existing code context on trivial input (refreshCodeContext not re-called)", async () => {
    const agent = makeAgent(baseConfig);
    const spy = vi.spyOn(agent, "refreshCodeContext");
    await refreshAgentContext(agent, "yes", baseConfig);
    expect(spy).not.toHaveBeenCalled();
  });

  it("still refreshes learnings on trivial input (heuristic fallback path)", async () => {
    mockLoadRelevantLearnings.mockResolvedValue([]);
    const agent = makeAgent(baseConfig);
    await refreshAgentContext(agent, "yes", baseConfig);
    // loadRelevantLearnings should be called even for trivial input
    expect(mockLoadRelevantLearnings).toHaveBeenCalled();
    // but generateEmbedding must NOT have been called
    expect(mockGenerateEmbedding).not.toHaveBeenCalled();
  });

  it("does call generateEmbedding when input is non-trivial (3+ words)", async () => {
    const fakeVector = [0.1, 0.2, 0.3];
    mockGenerateEmbedding.mockResolvedValue(fakeVector);
    mockSearchCode.mockResolvedValue([]);
    const agent = makeAgent(baseConfig);
    await refreshAgentContext(agent, "fix the auth bug", baseConfig);
    expect(mockGenerateEmbedding).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Sprint 83 — Item 1: codeRagMinScore wired through to searchCode
// ---------------------------------------------------------------------------

describe("refreshAgentContext — codeRagMinScore passed to searchCode", () => {
  it("passes config.codeRagMinScore to searchCode when set", async () => {
    const fakeVector = [0.5, 0.5, 0.5];
    mockGenerateEmbedding.mockResolvedValue(fakeVector);
    mockSearchCode.mockResolvedValue([]);

    const configWithMinScore: Config = { ...baseConfig, codeRagMinScore: 0.5 };
    const agent = makeAgent(configWithMinScore);
    await refreshAgentContext(agent, "authenticate user session", configWithMinScore);

    expect(mockSearchCode).toHaveBeenCalledWith(
      expect.any(String), // cwd
      fakeVector,
      3,                  // k
      0.5,                // minScore from config
    );
  });

  it("passes DEFAULT_CODE_RAG_MIN_SCORE when codeRagMinScore is undefined", async () => {
    const fakeVector = [0.4, 0.4, 0.4];
    mockGenerateEmbedding.mockResolvedValue(fakeVector);
    mockSearchCode.mockResolvedValue([]);

    const agent = makeAgent(baseConfig); // no codeRagMinScore
    await refreshAgentContext(agent, "find the parser logic now", baseConfig);

    // 4th arg should be 0.25 (DEFAULT_CODE_RAG_MIN_SCORE)
    const callArgs = mockSearchCode.mock.calls[0];
    expect(callArgs[3]).toBe(0.25);
  });
});

describe("one-shot mode — code context injected via refreshAgentContext before agent.run()", () => {
  it("code context block appears in conversation when Ollama is configured and results found", async () => {
    const fakeVector = [0.5, 0.5, 0.5];
    mockGenerateEmbedding.mockResolvedValue(fakeVector);
    const mockResult: CodeSearchResult = {
      path: "src/utils.ts",
      score: 0.8,
      snippet: "export const util = () => {};",
    };
    mockSearchCode.mockResolvedValue([mockResult]);

    const agent = makeAgent(baseConfig);
    // Simulate one-shot mode: refreshAgentContext then agent.run
    await refreshAgentContext(agent, "find utility functions now", baseConfig);
    await agent.run("find utility functions");

    const msgs = agent.getConversation().getMessages();
    const hasCtx = msgs.some(
      (m) => m.role === "user" && (m.content ?? "").startsWith(Conversation.CODE_CONTEXT_MARKER),
    );
    expect(hasCtx).toBe(true);
  });
});
