import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks — created before vi.mock() factories run (vitest ESM requirement)
// ---------------------------------------------------------------------------
const { spawnSyncMock, agentRunMock, askMock, createRlMock } = vi.hoisted(() => ({
  spawnSyncMock: vi.fn(),
  agentRunMock: vi.fn(),
  askMock: vi.fn(),
  createRlMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawnSync: spawnSyncMock,
}));

vi.mock("../../src/core/agent.js", () => ({
  Agent: vi.fn(),
}));

vi.mock("../../src/cli/prompt-util.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/cli/prompt-util.js")>();
  return {
    createRl: createRlMock,
    ask: askMock,
    PromptInterrupt: real.PromptInterrupt,
  };
});

// ---------------------------------------------------------------------------
// Import the module under test AFTER mocks are declared
// ---------------------------------------------------------------------------
import { Agent } from "../../src/core/agent.js";
import { buildCommitMessage, runCommitFlow, runGitCommit, SecretWarningError } from "../../src/cli/commit.js";
import { PromptInterrupt } from "../../src/cli/prompt-util.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Record<string, unknown> = {}): import("../../src/core/config.js").Config {
  return {
    provider: "openai-api",
    model: "gpt-4o",
    fast_model: "gpt-4o-mini",
    codexPath: "codex",
    maxTurns: 50,
    timeout: 120_000,
    allowDestructive: false,
    verifyCommand: "npm test",
    requireSpecification: false,
    browser: false,
    ...overrides,
  } as unknown as import("../../src/core/config.js").Config;
}

function makeStagedDiff(lineCount = 5): string {
  const lines = [
    "diff --git a/src/hello.ts b/src/hello.ts",
    "--- a/src/hello.ts",
    "+++ b/src/hello.ts",
    "@@ -1,3 +1,4 @@",
    " const x = 1;",
  ];
  for (let i = 0; i < lineCount; i++) {
    lines.push(`+const added${i} = ${i};`);
  }
  return lines.join("\n");
}

function makeLargeDiff(): string {
  const lines = ["diff --git a/big.ts b/big.ts", "+++ b/big.ts", "@@ -1 +1 @@"];
  for (let i = 0; i < 4001; i++) lines.push(`+const x${i} = ${i};`);
  return lines.join("\n");
}

const GIT_OK = (stdout = "", stderr = "") => ({
  status: 0, stdout, stderr, pid: 1, output: [], signal: null, error: undefined,
});

const GIT_FAIL = (stdout = "", stderr = "") => ({
  status: 1, stdout, stderr, pid: 1, output: [], signal: null, error: undefined,
});

function setupSpawnMocks({
  isRepo = true,
  hasHead = true,
  hasStagedStat = true,
  diff = makeStagedDiff(),
  commitStatus = 0,
  commitStdout = "[main abc1234] feat: add greeting",
  commitStderr = "",
}: {
  isRepo?: boolean;
  hasHead?: boolean;
  hasStagedStat?: boolean;
  diff?: string;
  commitStatus?: number;
  commitStdout?: string;
  commitStderr?: string;
} = {}) {
  spawnSyncMock.mockImplementation((_cmd: string, args: string[]) => {
    const arg = args.join(" ");
    if (arg.includes("--git-dir")) {
      return isRepo ? GIT_OK(".git") : GIT_FAIL("", "fatal: not a git repository");
    }
    if (arg.includes("rev-parse HEAD")) {
      return hasHead ? GIT_OK("abc1234") : GIT_FAIL("", "fatal: ambiguous argument 'HEAD'");
    }
    if (arg.includes("--cached --stat")) {
      return hasStagedStat
        ? GIT_OK("src/hello.ts | 5 +++++\n 1 file changed, 5 insertions(+)")
        : GIT_OK("");
    }
    if (arg.includes("--cached")) {
      return GIT_OK(diff);
    }
    if (arg.startsWith("commit")) {
      return commitStatus === 0
        ? GIT_OK(commitStdout, commitStderr)
        : GIT_FAIL("", commitStderr || "error: commit hook failed");
    }
    return GIT_OK();
  });
}

/** Re-establish all mock implementations. Called in every beforeEach. */
function resetMocks(agentReturnValue = "feat(hello): add greeting constants") {
  vi.resetAllMocks();
  // Re-establish agent run mock first (captured by reference in the Agent class below)
  agentRunMock.mockResolvedValue(agentReturnValue);
  // Vitest 4.x requires `mockImplementation` with a `class` keyword for constructor mocks.
  // Arrow functions and `mockReturnValue` both throw when called with `new`.
  vi.mocked(Agent).mockImplementation(
    class { run = agentRunMock; } as unknown as typeof Agent,
  );
  // Re-establish createRl mock
  createRlMock.mockReturnValue({ close: vi.fn(), once: vi.fn() });
  // Re-establish git mocks
  setupSpawnMocks();
}

// ---------------------------------------------------------------------------
// buildCommitMessage()
// ---------------------------------------------------------------------------

describe("buildCommitMessage()", () => {
  beforeEach(() => {
    resetMocks();
  });

  // 1. Not a git repo
  it("throws 'Not a git repository.' when git rev-parse --git-dir fails", async () => {
    setupSpawnMocks({ isRepo: false });
    await expect(buildCommitMessage(makeConfig())).rejects.toThrow("Not a git repository.");
  });

  // 2. Nothing staged (with commits)
  it("throws 'Nothing staged.' when nothing is staged and HEAD exists", async () => {
    setupSpawnMocks({ hasStagedStat: false, diff: "" });
    await expect(buildCommitMessage(makeConfig())).rejects.toThrow("Nothing staged.");
  });

  // 3. Nothing staged + unborn HEAD (initial repo)
  it("throws 'Nothing staged.' on unborn HEAD with empty diff", async () => {
    setupSpawnMocks({ hasHead: false, hasStagedStat: false, diff: "" });
    await expect(buildCommitMessage(makeConfig())).rejects.toThrow("Nothing staged.");
  });

  // 4. Diff too large
  it("throws 'Diff too large' when diff exceeds 4000 lines", async () => {
    setupSpawnMocks({ diff: makeLargeDiff() });
    await expect(buildCommitMessage(makeConfig())).rejects.toThrow("Diff too large");
  });

  // 5. Secret detected → throws SecretWarningError
  it("throws SecretWarningError when diff contains an AWS key", async () => {
    const diffWithSecret = makeStagedDiff() + "\n+const key = 'AKIAIOSFODNN7EXAMPLE';";
    setupSpawnMocks({ diff: diffWithSecret });
    await expect(buildCommitMessage(makeConfig())).rejects.toThrow(SecretWarningError);
  });

  // 6. Secret bypassed with secretsSendAnyway: true
  it("proceeds past secret warning when secretsSendAnyway is true", async () => {
    const diffWithSecret = makeStagedDiff() + "\n+const key = 'AKIAIOSFODNN7EXAMPLE';";
    setupSpawnMocks({ diff: diffWithSecret });
    const result = await buildCommitMessage(makeConfig(), { secretsSendAnyway: true });
    expect(result).not.toBeNull();
    expect(result!.message).toBe("feat(hello): add greeting constants");
  });

  // 7. Happy path: returns CommitMessageResult
  it("returns CommitMessageResult on success", async () => {
    const result = await buildCommitMessage(makeConfig());
    expect(result).not.toBeNull();
    expect(result!.message).toBe("feat(hello): add greeting constants");
    expect(typeof result!.diffStat).toBe("string");
  });

  // 8. Model returns empty → returns null
  it("returns null when model returns empty string", async () => {
    agentRunMock.mockResolvedValue("  ");
    const result = await buildCommitMessage(makeConfig());
    expect(result).toBeNull();
  });

  // 9. Uses fast_model as modelOverride
  it("passes fast_model as modelOverride to agent.run()", async () => {
    await buildCommitMessage(makeConfig({ fast_model: "gpt-4o-mini" }));
    expect(agentRunMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ modelOverride: "gpt-4o-mini" }),
    );
  });

  // 10. Falls back to model when fast_model is undefined
  it("falls back to config.model when fast_model is undefined", async () => {
    await buildCommitMessage(makeConfig({ fast_model: undefined }));
    expect(agentRunMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ modelOverride: "gpt-4o" }),
    );
  });
});

// ---------------------------------------------------------------------------
// runCommitFlow() — interactive mode
// ---------------------------------------------------------------------------

describe("runCommitFlow() — interactive", () => {
  beforeEach(() => {
    resetMocks();
  });

  // 11. [a]ccept → runs git commit
  it("[a]ccept commits with the proposed message", async () => {
    askMock.mockResolvedValue("a");
    await runCommitFlow(makeConfig());
    const commitCall = spawnSyncMock.mock.calls.find(
      (c: string[]) => c[0] === "git" && c[1][0] === "commit",
    );
    expect(commitCall).toBeDefined();
    expect(commitCall![1]).toContain("feat(hello): add greeting constants");
  });

  // 12. [c]ancel → no git commit
  it("[c]ancel does not run git commit", async () => {
    askMock.mockResolvedValue("c");
    await runCommitFlow(makeConfig());
    const commitCall = spawnSyncMock.mock.calls.find(
      (c: string[]) => c[0] === "git" && c[1][0] === "commit",
    );
    expect(commitCall).toBeUndefined();
  });

  // 13. Commit hook failure → exits non-zero
  it("commit hook failure exits non-zero", async () => {
    setupSpawnMocks({ commitStatus: 1, commitStderr: "hook: no emoji in message" });
    askMock.mockResolvedValue("a");
    const exit = vi.spyOn(process, "exit").mockImplementation((_code?: number) => {
      throw new Error("process.exit");
    });
    await expect(runCommitFlow(makeConfig())).rejects.toThrow("process.exit");
    expect(exit).toHaveBeenCalledWith(1);
    exit.mockRestore();
  });

  // 20. [e]dit path (no $EDITOR) → readline fallback → commits edited message
  it("[e]dit with no $EDITOR uses readline fallback and commits the edited message", async () => {
    const savedEditor = process.env.EDITOR;
    const savedVisual = process.env.VISUAL;
    delete process.env.EDITOR;
    delete process.env.VISUAL;
    try {
      // First ask() call: main prompt → "e"
      // Second ask() call: edit prompt → user's new message
      askMock
        .mockResolvedValueOnce("e")
        .mockResolvedValueOnce("fix: edited by user");
      await runCommitFlow(makeConfig());
      const commitCall = spawnSyncMock.mock.calls.find(
        (c: string[]) => c[0] === "git" && c[1][0] === "commit",
      );
      expect(commitCall).toBeDefined();
      expect(commitCall![1]).toContain("fix: edited by user");
    } finally {
      if (savedEditor !== undefined) process.env.EDITOR = savedEditor;
      if (savedVisual !== undefined) process.env.VISUAL = savedVisual;
    }
  });

  // 21. [e]dit path → empty input → commit cancelled (no git commit)
  it("[e]dit with empty readline input cancels the commit", async () => {
    const savedEditor = process.env.EDITOR;
    const savedVisual = process.env.VISUAL;
    delete process.env.EDITOR;
    delete process.env.VISUAL;
    try {
      askMock
        .mockResolvedValueOnce("e")
        .mockResolvedValueOnce(""); // empty → cancel
      await runCommitFlow(makeConfig());
      const commitCall = spawnSyncMock.mock.calls.find(
        (c: string[]) => c[0] === "git" && c[1][0] === "commit",
      );
      expect(commitCall).toBeUndefined();
    } finally {
      if (savedEditor !== undefined) process.env.EDITOR = savedEditor;
      if (savedVisual !== undefined) process.env.VISUAL = savedVisual;
    }
  });
});

// ---------------------------------------------------------------------------
// runCommitFlow() — --auto mode
// ---------------------------------------------------------------------------

describe("runCommitFlow() — --auto", () => {
  beforeEach(() => {
    resetMocks();
  });

  // 14. --auto commits without prompting
  it("--auto commits immediately without ask()", async () => {
    await runCommitFlow(makeConfig(), { auto: true });
    expect(askMock).not.toHaveBeenCalled();
    const commitCall = spawnSyncMock.mock.calls.find(
      (c: string[]) => c[0] === "git" && c[1][0] === "commit",
    );
    expect(commitCall).toBeDefined();
  });

  // 15. --auto + nothing staged → exits non-zero
  it("--auto exits non-zero when nothing is staged", async () => {
    setupSpawnMocks({ hasStagedStat: false, diff: "" });
    const exit = vi.spyOn(process, "exit").mockImplementation((_code?: number) => {
      throw new Error("process.exit");
    });
    await expect(runCommitFlow(makeConfig(), { auto: true })).rejects.toThrow("process.exit");
    expect(exit).toHaveBeenCalledWith(1);
    exit.mockRestore();
  });

  // 16. --auto + empty model response → exits non-zero
  it("--auto exits non-zero when model returns empty", async () => {
    agentRunMock.mockResolvedValue("");
    const exit = vi.spyOn(process, "exit").mockImplementation((_code?: number) => {
      throw new Error("process.exit");
    });
    await expect(runCommitFlow(makeConfig(), { auto: true })).rejects.toThrow("process.exit");
    expect(exit).toHaveBeenCalledWith(1);
    exit.mockRestore();
  });

  // 17. --auto + secret detected → exits non-zero (no interactive prompt)
  it("--auto exits non-zero when diff contains a secret", async () => {
    const diffWithSecret = makeStagedDiff() + "\n+const key = 'AKIAIOSFODNN7EXAMPLE';";
    setupSpawnMocks({ diff: diffWithSecret });
    const exit = vi.spyOn(process, "exit").mockImplementation((_code?: number) => {
      throw new Error("process.exit");
    });
    await expect(runCommitFlow(makeConfig(), { auto: true })).rejects.toThrow("process.exit");
    expect(exit).toHaveBeenCalledWith(1);
    exit.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// runCommitFlow() — --preview mode
// ---------------------------------------------------------------------------

describe("runCommitFlow() — --preview", () => {
  beforeEach(() => {
    resetMocks();
  });

  // 18. --preview prints message and does not commit
  it("--preview does not run git commit", async () => {
    await runCommitFlow(makeConfig(), { preview: true });
    const commitCall = spawnSyncMock.mock.calls.find(
      (c: string[]) => c[0] === "git" && c[1][0] === "commit",
    );
    expect(commitCall).toBeUndefined();
  });

  // 19. --preview does not prompt the user
  it("--preview does not call ask()", async () => {
    await runCommitFlow(makeConfig(), { preview: true });
    expect(askMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// runCommitFlow() — null-model interactive fallback
// ---------------------------------------------------------------------------

describe("runCommitFlow() — null-model interactive fallback", () => {
  beforeEach(() => {
    resetMocks();
    // Make the model return empty so result === null
    agentRunMock.mockResolvedValue("");
  });

  // 22. null-model + user types a message → commits with that message
  it("prompts for manual message when model returns empty and commits it", async () => {
    askMock.mockResolvedValue("fix: manual commit message");
    await runCommitFlow(makeConfig());
    const commitCall = spawnSyncMock.mock.calls.find(
      (c: string[]) => c[0] === "git" && c[1][0] === "commit",
    );
    expect(commitCall).toBeDefined();
    expect(commitCall![1]).toContain("fix: manual commit message");
  });

  // 23. null-model + user presses Enter (empty) → commit cancelled
  it("cancels commit when user provides empty manual message", async () => {
    askMock.mockResolvedValue("");
    await runCommitFlow(makeConfig());
    const commitCall = spawnSyncMock.mock.calls.find(
      (c: string[]) => c[0] === "git" && c[1][0] === "commit",
    );
    expect(commitCall).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// runCommitFlow() — SecretWarningError [s]end anyway path
// ---------------------------------------------------------------------------

describe("runCommitFlow() — secret [s]end anyway path", () => {
  beforeEach(() => {
    resetMocks();
  });

  // 24. Secret detected → user chooses [s]end anyway → commits
  it("[s]end anyway bypasses SecretWarningError and commits", async () => {
    const diffWithSecret = makeStagedDiff() + "\n+const key = 'AKIAIOSFODNN7EXAMPLE';";
    setupSpawnMocks({ diff: diffWithSecret });
    // First ask(): secret prompt → "s", second ask(): main prompt → "a"
    askMock
      .mockResolvedValueOnce("s")
      .mockResolvedValueOnce("a");
    await runCommitFlow(makeConfig());
    const commitCall = spawnSyncMock.mock.calls.find(
      (c: string[]) => c[0] === "git" && c[1][0] === "commit",
    );
    expect(commitCall).toBeDefined();
  });

  // 25. Secret detected → user chooses [c]ancel → no commit
  it("[c]ancel on secret warning does not commit", async () => {
    const diffWithSecret = makeStagedDiff() + "\n+const key = 'AKIAIOSFODNN7EXAMPLE';";
    setupSpawnMocks({ diff: diffWithSecret });
    askMock.mockResolvedValueOnce("c");
    await runCommitFlow(makeConfig());
    const commitCall = spawnSyncMock.mock.calls.find(
      (c: string[]) => c[0] === "git" && c[1][0] === "commit",
    );
    expect(commitCall).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// openEditor() — with $EDITOR set
// ---------------------------------------------------------------------------

describe("runCommitFlow() — openEditor() with $EDITOR set", () => {
  beforeEach(() => {
    resetMocks();
  });

  // 26. $EDITOR set, editor exits 0, file written → commits edited message
  it("[e]dit with $EDITOR set reads edited file and commits it", async () => {
    process.env.EDITOR = "/usr/bin/true"; // any non-empty value
    try {
      // spawnSync mock: for the editor call (first non-git spawnSync after git calls),
      // return status 0. Then the code reads tmpFile. We need to mock fs.readFileSync.
      // Instead: intercept spawnSync to capture the tmpFile path and write to it.
      let capturedTmpFile: string | null = null;
      spawnSyncMock.mockImplementation((_cmd: string, args: string[]) => {
        const arg = args.join(" ");
        if (arg.includes("--git-dir")) return GIT_OK(".git");
        if (arg.includes("rev-parse HEAD")) return GIT_OK("abc1234");
        if (arg.includes("--cached --stat")) return GIT_OK("src/hello.ts | 5 +++++\n 1 file changed");
        if (arg.includes("--cached")) return GIT_OK(makeStagedDiff());
        if (arg.startsWith("commit")) return GIT_OK("[main abc] feat: add edited thing");
        // Editor call: capture the tmpFile path and write the edited message to it
        capturedTmpFile = args[args.length - 1];
        const { writeFileSync } = require("node:fs");
        writeFileSync(capturedTmpFile, "feat: edited via real editor");
        return GIT_OK();
      });
      askMock.mockResolvedValueOnce("e"); // main prompt → [e]dit
      await runCommitFlow(makeConfig());
      const commitCall = spawnSyncMock.mock.calls.find(
        (c: string[]) => c[0] === "git" && c[1][0] === "commit",
      );
      expect(commitCall).toBeDefined();
      expect(commitCall![1]).toContain("feat: edited via real editor");
      expect(capturedTmpFile).not.toBeNull();
    } finally {
      delete process.env.EDITOR;
    }
  });

  // 27. $EDITOR set, editor exits non-zero → commit cancelled
  it("[e]dit with editor that exits non-zero cancels commit", async () => {
    process.env.EDITOR = "/usr/bin/false";
    try {
      spawnSyncMock.mockImplementation((_cmd: string, args: string[]) => {
        const arg = args.join(" ");
        if (arg.includes("--git-dir")) return GIT_OK(".git");
        if (arg.includes("rev-parse HEAD")) return GIT_OK("abc1234");
        if (arg.includes("--cached --stat")) return GIT_OK("src/hello.ts | 5 +++++");
        if (arg.includes("--cached")) return GIT_OK(makeStagedDiff());
        if (arg.startsWith("commit")) return GIT_OK();
        // Editor call: return non-zero status
        return GIT_FAIL();
      });
      askMock.mockResolvedValueOnce("e"); // main prompt → [e]dit
      await runCommitFlow(makeConfig());
      const commitCall = spawnSyncMock.mock.calls.find(
        (c: string[]) => c[0] === "git" && c[1][0] === "commit",
      );
      expect(commitCall).toBeUndefined();
    } finally {
      delete process.env.EDITOR;
    }
  });
});

// ---------------------------------------------------------------------------
// runCommitFlow() — PromptInterrupt (Ctrl+C) handling
// ---------------------------------------------------------------------------

describe("runCommitFlow() — PromptInterrupt (Ctrl+C) handling", () => {
  beforeEach(() => {
    resetMocks();
  });

  // 31. Ctrl+C at main [a/e/c] prompt → commit cancelled, no git commit
  it("Ctrl+C at main prompt cancels commit without error", async () => {
    askMock.mockImplementationOnce(() => { throw new PromptInterrupt(); });
    await runCommitFlow(makeConfig());
    const commitCall = spawnSyncMock.mock.calls.find(
      (c: string[]) => c[0] === "git" && c[1][0] === "commit",
    );
    expect(commitCall).toBeUndefined();
  });

  // 32. Ctrl+C at secret [s]end-anyway prompt → commit cancelled
  it("Ctrl+C at secret [s]end-anyway prompt cancels commit without error", async () => {
    const diffWithSecret = makeStagedDiff() + "\n+const key = 'AKIAIOSFODNN7EXAMPLE';";
    setupSpawnMocks({ diff: diffWithSecret });
    askMock.mockImplementationOnce(() => { throw new PromptInterrupt(); });
    await runCommitFlow(makeConfig());
    const commitCall = spawnSyncMock.mock.calls.find(
      (c: string[]) => c[0] === "git" && c[1][0] === "commit",
    );
    expect(commitCall).toBeUndefined();
  });

  // 33. Ctrl+C at null-model manual-message prompt → commit cancelled
  it("Ctrl+C at manual-message prompt (null model) cancels commit without error", async () => {
    agentRunMock.mockResolvedValue(""); // model returns empty → result === null
    askMock.mockImplementationOnce(() => { throw new PromptInterrupt(); });
    await runCommitFlow(makeConfig());
    const commitCall = spawnSyncMock.mock.calls.find(
      (c: string[]) => c[0] === "git" && c[1][0] === "commit",
    );
    expect(commitCall).toBeUndefined();
  });

  // 34. Ctrl+C in openEditor readline fallback → commit cancelled
  it("Ctrl+C in openEditor readline fallback cancels commit without error", async () => {
    const savedEditor = process.env.EDITOR;
    const savedVisual = process.env.VISUAL;
    delete process.env.EDITOR;
    delete process.env.VISUAL;
    try {
      // First ask(): main prompt → "e" (edit)
      // Second ask(): openEditor readline fallback → PromptInterrupt
      askMock
        .mockResolvedValueOnce("e")
        .mockImplementationOnce(() => { throw new PromptInterrupt(); });
      await runCommitFlow(makeConfig());
      const commitCall = spawnSyncMock.mock.calls.find(
        (c: string[]) => c[0] === "git" && c[1][0] === "commit",
      );
      expect(commitCall).toBeUndefined();
    } finally {
      if (savedEditor !== undefined) process.env.EDITOR = savedEditor;
      if (savedVisual !== undefined) process.env.VISUAL = savedVisual;
    }
  });
});

// ---------------------------------------------------------------------------
// runGitCommit() — direct unit tests
// ---------------------------------------------------------------------------

describe("runGitCommit()", () => {
  beforeEach(() => {
    resetMocks();
  });

  // 28. Successful commit → ok=true, output contains stdout
  it("returns ok=true and stdout on successful commit", () => {
    spawnSyncMock.mockReturnValue(GIT_OK("[main abc1234] feat: add thing", ""));
    const { ok, output } = runGitCommit("feat: add thing");
    expect(ok).toBe(true);
    expect(output).toContain("[main abc1234]");
  });

  // 29. Failed commit → ok=false, output contains stderr
  it("returns ok=false and stderr on failed commit", () => {
    spawnSyncMock.mockReturnValue(GIT_FAIL("", "error: pre-commit hook failed"));
    const { ok, output } = runGitCommit("feat: add thing");
    expect(ok).toBe(false);
    expect(output).toContain("pre-commit hook failed");
  });

  // 30. Both stdout and stderr populated → output joins them
  it("joins stdout and stderr in output", () => {
    spawnSyncMock.mockReturnValue(GIT_FAIL("some stdout", "some stderr"));
    const { output } = runGitCommit("feat: add thing");
    expect(output).toContain("some stdout");
    expect(output).toContain("some stderr");
  });
});
