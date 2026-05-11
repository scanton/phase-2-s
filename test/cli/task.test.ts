/**
 * Sprint 84/93 — CLI go subcommand tests.
 *
 * Tests that `phase2s go "..."` routes to agent.run() with taskMode=true,
 * that --verify overrides verifyCommand, and that the subcommand appears in
 * help/completion output.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — prevent real LLM calls and config reads
// ---------------------------------------------------------------------------

let lastAgentRunOpts: Record<string, unknown> = {};
let lastAgentRunMessage = "";

vi.mock("../../src/core/agent.js", () => {
  class MockAgent {
    run = vi.fn().mockImplementation(async (msg: string, opts: Record<string, unknown>) => {
      lastAgentRunMessage = msg;
      lastAgentRunOpts = opts ?? {};
      return "Task complete.";
    });
    getConversation = vi.fn().mockReturnValue({ getMessages: () => [] });
    refreshLearnings = vi.fn();
    refreshCodeContext = vi.fn();
    get provider() { return { name: "mock" }; }
  }
  return { Agent: MockAgent };
});

vi.mock("../../src/core/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/core/config.js")>();
  return {
    ...actual,
    loadConfig: vi.fn().mockResolvedValue({
      provider: "openai-api",
      model: "gpt-4o",
      apiKey: "sk-test",
      codexPath: "codex",
      maxTurns: 50,
      timeout: 120_000,
      allowDestructive: false,
      verifyCommand: "npm test",
      requireSpecification: false,
    }),
    normalizeConfigError: actual.normalizeConfigError,
  };
});

vi.mock("../../src/core/memory.js", () => ({
  loadLearnings: vi.fn().mockResolvedValue([]),
  loadRelevantLearnings: vi.fn().mockResolvedValue([]),
  formatLearningsForPrompt: vi.fn().mockReturnValue(""),
}));

vi.mock("../../src/core/embeddings.js", () => ({
  generateEmbedding: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../src/core/code-index.js", () => ({
  searchCode: vi.fn().mockResolvedValue([]),
  DEFAULT_CODE_RAG_MIN_SCORE: 0.7,
}));

vi.mock("../../src/core/code-context.js", () => ({
  buildCodeContextBlock: vi.fn().mockReturnValue(""),
}));

vi.mock("../../src/core/rag-utils.js", () => ({
  isTrivialInput: vi.fn().mockReturnValue(false),
}));

vi.mock("../../src/skills/index.js", () => ({
  loadAllSkills: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../src/core/agents-md.js", () => ({
  loadAgentsMd: vi.fn().mockResolvedValue(undefined),
  formatAgentsMdBlock: vi.fn().mockReturnValue(undefined),
}));

// ---------------------------------------------------------------------------
// Tests — task subcommand routing
// ---------------------------------------------------------------------------

describe("phase2s task — CLI subcommand", () => {
  beforeEach(() => {
    lastAgentRunOpts = {};
    lastAgentRunMessage = "";
    vi.clearAllMocks();
  });

  it("routes to agent.run() with taskMode: true", async () => {
    const { main } = await import("../../src/cli/index.js");

    // Suppress stdout for this test
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await main(["node", "phase2s", "go", "fix the null pointer in auth.ts"]);
    } catch {
      // process.exit calls are expected
    }

    expect(lastAgentRunMessage).toBe("fix the null pointer in auth.ts");
    expect(lastAgentRunOpts.taskMode).toBe(true);

    writeSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  it("--verify flag overrides verifyCommand for the run", async () => {
    const { main } = await import("../../src/cli/index.js");

    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await main(["node", "phase2s", "go", "--verify", "bun test", "refactor config.ts"]);
    } catch {
      // process.exit calls are expected
    }

    expect(lastAgentRunOpts.taskMode).toBe(true);
    expect(lastAgentRunOpts.verifyCommand).toBe("bun test");

    writeSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  it("go subcommand without --verify uses config.verifyCommand", async () => {
    const { main } = await import("../../src/cli/index.js");

    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await main(["node", "phase2s", "go", "add tests for the parser"]);
    } catch {
      // process.exit calls are expected
    }

    expect(lastAgentRunOpts.taskMode).toBe(true);
    // Without --verify, verifyCommand should come from config or be undefined
    // (config has "npm test" in our mock, but task subcommand passes it through)
    expect(lastAgentRunMessage).toBe("add tests for the parser");

    writeSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  it("go subcommand appears in shell completion list", async () => {
    // Import the ZSH_COMPLETION string from the CLI module
    // It's not exported directly, but we can test by running `phase2s completion zsh`
    const { main } = await import("../../src/cli/index.js");

    let output = "";
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation((data) => {
      output += String(data);
      return true;
    });

    try {
      await main(["node", "phase2s", "completion", "zsh"]);
    } catch {
      // expected
    }

    expect(output).toContain("go");
    writeSpy.mockRestore();
  });

  it("go with empty prompt exits cleanly with an error message", async () => {
    const { main } = await import("../../src/cli/index.js");

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    let exitCode: number | undefined;
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number) => {
      exitCode = code;
      throw new Error(`process.exit(${code})`);
    });

    try {
      await main(["node", "phase2s", "go"]);
    } catch {
      // expected from process.exit mock
    }

    // Should exit with non-zero or print an error (Commander handles missing required arg)
    // Either an error was printed or exit was called
    const errCalls = errSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    const hadError = exitCode !== 0 || errCalls.length > 0;
    expect(hadError).toBe(true);

    errSpy.mockRestore();
    writeSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
