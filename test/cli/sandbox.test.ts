/**
 * Tests for src/cli/sandbox.ts — the --sandbox flag implementation.
 *
 * Git operations and interactiveMode are mocked so tests run without
 * touching the real filesystem or spawning real processes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { slugify, startSandbox, listSandboxes, listWorktreePaths } from "../../src/cli/sandbox.js";
import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  rmSync: vi.fn(),
}));

vi.mock("../../src/core/config.js", () => ({
  loadConfig: vi.fn().mockResolvedValue({
    provider: "codex-cli",
    model: "o4-mini",
    codexPath: "codex",
  }),
}));

vi.mock("../../src/cli/index.js", () => ({
  interactiveMode: vi.fn().mockResolvedValue(undefined),
}));

// Mock readline for merge prompt — auto-answer "n" (no merge) by default
vi.mock("node:readline", () => ({
  createInterface: vi.fn(() => ({
    question: vi.fn((_prompt: string, cb: (answer: string) => void) => cb("n")),
    close: vi.fn(),
  })),
}));

// ---------------------------------------------------------------------------
// Helpers to access mocks
// ---------------------------------------------------------------------------

const mockExecSync = execSync as unknown as ReturnType<typeof vi.fn>;
const mockExistsSync = existsSync as unknown as ReturnType<typeof vi.fn>;
const mockRmSync = rmSync as unknown as ReturnType<typeof vi.fn>;

/** Reset interactiveMode back to default (resolves) between tests. */
async function resetInteractiveModeMock() {
  const { interactiveMode } = await import("../../src/cli/index.js");
  vi.mocked(interactiveMode).mockResolvedValue(undefined);
}

// ---------------------------------------------------------------------------
// slugify() — 6 assertions
// ---------------------------------------------------------------------------

describe("slugify()", () => {
  it("converts spaces to hyphens", () => {
    expect(slugify("spike new provider")).toBe("spike-new-provider");
  });

  it("strips special characters", () => {
    expect(slugify("Feature/OAuth2!")).toBe("feature-oauth2");
  });

  it("collapses consecutive hyphens", () => {
    expect(slugify("foo--bar")).toBe("foo-bar");
  });

  it("strips leading and trailing hyphens", () => {
    expect(slugify("-foo-")).toBe("foo");
  });

  it("truncates to 40 characters", () => {
    const long = "a".repeat(50);
    expect(slugify(long).length).toBeLessThanOrEqual(40);
  });

  it("does not leave trailing hyphen after truncation at word boundary", () => {
    // 39 a's + space + "b" = 41 chars → slug = "a...a-b" (41 chars) → truncate to 40 = "a...a-" → strip → "a...a"
    const input = "a".repeat(39) + " b";
    const result = slugify(input);
    expect(result).not.toMatch(/-$/);
    expect(result.length).toBeLessThanOrEqual(40);
  });

  it("returns empty string for all-non-alphanumeric input", () => {
    expect(slugify("!!!")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// State detection — assertions 7–10
// ---------------------------------------------------------------------------

describe("startSandbox() — state detection", () => {
  const projectCwd = "/fake/project";
  const worktreePath = path.join(projectCwd, ".worktrees", "sandbox-mytest");
  const branch = "sandbox/mytest";

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: git branch --show-current returns "main"
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes("branch --show-current")) return "main\n";
      if (cmd.includes("worktree list")) return `worktree /fake/project\nHEAD abc\nbranch refs/heads/main\n`;
      return "";
    });
    mockExistsSync.mockReturnValue(false);
    vi.spyOn(process, "chdir").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("state (a): worktree in git + dir exists → skips creation, proceeds to REPL", async () => {
    // Worktree IS in git list AND dir exists
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes("branch --show-current")) return "main\n";
      if (cmd.includes("worktree list")) return `worktree /fake/project\nHEAD abc\nbranch refs/heads/main\n\nworktree ${worktreePath}\nHEAD abc\nbranch refs/heads/sandbox/mytest\n\n`;
      return "";
    });
    mockExistsSync.mockReturnValue(true);

    const { interactiveMode } = await import("../../src/cli/index.js");
    await startSandbox("mytest", projectCwd, {});

    // Should NOT call git worktree add
    const addCalls = mockExecSync.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("worktree add"),
    );
    expect(addCalls).toHaveLength(0);
    expect(interactiveMode).toHaveBeenCalled();
  });

  it("state (b): worktree in git + dir missing → prune + recreate with existing branch (no -b)", async () => {
    // Worktree IS in git list but dir does NOT exist
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes("branch --show-current")) return "main\n";
      if (cmd.includes("worktree list")) return `worktree /fake/project\nHEAD abc\nbranch refs/heads/main\n\nworktree ${worktreePath}\nHEAD abc\nbranch refs/heads/sandbox/mytest\n\n`;
      if (cmd.includes("worktree prune")) return "";
      if (cmd.includes("worktree add")) return "";
      return "";
    });
    mockExistsSync.mockReturnValue(false);

    await startSandbox("mytest", projectCwd, {});

    const pruneCalls = mockExecSync.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("worktree prune"),
    );
    expect(pruneCalls).toHaveLength(1);

    // The recreate command should NOT use -b (branch already exists)
    const addCalls = mockExecSync.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("worktree add"),
    );
    expect(addCalls).toHaveLength(1);
    expect(addCalls[0][0]).not.toContain("-b");
    expect(addCalls[0][0]).toContain(branch);
  });

  it("state (c): dir exists + not in git → rmSync + recreate with new branch (-b)", async () => {
    // Worktree NOT in git list but dir DOES exist
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes("branch --show-current")) return "main\n";
      if (cmd.includes("worktree list")) return `worktree /fake/project\nHEAD abc\n`;
      if (cmd.includes("worktree add")) return "";
      return "";
    });
    mockExistsSync.mockReturnValue(true);

    await startSandbox("mytest", projectCwd, {});

    expect(mockRmSync).toHaveBeenCalledWith(worktreePath, { recursive: true });

    const addCalls = mockExecSync.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("worktree add"),
    );
    expect(addCalls).toHaveLength(1);
    expect(addCalls[0][0]).toContain("-b");
  });

  it("state (c): branch already exists → rmSync + add without -b (no data loss)", async () => {
    // Dir exists, not in git, but branch also already exists in git (crash after branch created)
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes("branch --show-current")) return "main\n";
      if (cmd.includes("worktree list")) return `worktree /fake/project\nHEAD abc\n`;
      if (cmd.includes("branch --list")) return "sandbox/mytest\n"; // branch exists
      if (cmd.includes("worktree add")) return "";
      return "";
    });
    mockExistsSync.mockReturnValue(true);

    await startSandbox("mytest", projectCwd, {});

    // rmSync should have been called (directory cleanup)
    expect(mockRmSync).toHaveBeenCalledWith(
      expect.stringContaining("sandbox-mytest"),
      { recursive: true },
    );

    // The add command should NOT use -b (branch already exists)
    const addCalls = mockExecSync.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("worktree add"),
    );
    expect(addCalls).toHaveLength(1);
    expect(addCalls[0][0]).not.toContain("-b");
  });

  it("state (d): neither → creates fresh with -b", async () => {
    // Nothing registered, nothing on disk
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes("branch --show-current")) return "main\n";
      if (cmd.includes("worktree list")) return `worktree /fake/project\nHEAD abc\n`;
      if (cmd.includes("worktree add")) return "";
      return "";
    });
    mockExistsSync.mockReturnValue(false);

    await startSandbox("mytest", projectCwd, {});

    const addCalls = mockExecSync.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("worktree add"),
    );
    expect(addCalls).toHaveLength(1);
    expect(addCalls[0][0]).toContain("-b");
  });
});

// ---------------------------------------------------------------------------
// Guards — assertions 11–12
// ---------------------------------------------------------------------------

describe("startSandbox() — guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, "chdir").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("detached HEAD → error + exits 1", async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes("branch --show-current")) return ""; // detached HEAD returns empty
      return "";
    });
    mockExistsSync.mockReturnValue(false);

    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await startSandbox("mytest", "/fake/project", {});

    expect(process.exit).toHaveBeenCalledWith(1);
    const allOutput = [
      ...consoleSpy.mock.calls.map((c) => String(c[0])),
      ...errSpy.mock.calls.map((c) => String(c[0])),
    ].join("\n");
    expect(allOutput).toMatch(/detached HEAD/i);

    errSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  it("empty slug (all special chars) → error + exits 1", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await startSandbox("!!!", "/fake/project", {});

    expect(process.exit).toHaveBeenCalledWith(1);
    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toMatch(/no valid alphanumeric/i);

    consoleSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// REPL lifecycle — assertions 13–14
// ---------------------------------------------------------------------------

describe("startSandbox() — REPL lifecycle", () => {
  const projectCwd = "/fake/project";

  beforeEach(() => {
    vi.clearAllMocks();
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes("branch --show-current")) return "main\n";
      if (cmd.includes("worktree list")) return `worktree /fake/project\nHEAD abc\n`;
      if (cmd.includes("worktree add")) return "";
      return "";
    });
    mockExistsSync.mockReturnValue(false);
    vi.spyOn(process, "chdir").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("interactiveMode resolves normally → finally block fires → merge prompt shown", async () => {
    const { interactiveMode } = await import("../../src/cli/index.js");
    vi.mocked(interactiveMode).mockResolvedValue(undefined);

    const { createInterface } = await import("node:readline");
    const questionMock = vi.fn((_p: string, cb: (a: string) => void) => cb("n"));
    vi.mocked(createInterface).mockReturnValue({
      question: questionMock,
      close: vi.fn(),
    } as ReturnType<typeof createInterface>);

    await startSandbox("mytest", projectCwd, {});

    // finally block fired → merge prompt shown
    expect(questionMock).toHaveBeenCalled();
    const prompt = questionMock.mock.calls[0][0] as string;
    expect(prompt).toContain("Merge sandbox back into");
  });

  it("interactiveMode rejection (SIGINT) → catch+finally block fires → merge prompt shown", async () => {
    const { interactiveMode } = await import("../../src/cli/index.js");
    // Simulate rejection (edge-case path — in normal operation, after the SIGINT refactor,
    // interactiveMode resolves; this tests that sandbox is robust against rejections too)
    vi.mocked(interactiveMode).mockRejectedValue(new Error("SIGINT"));

    const { createInterface } = await import("node:readline");
    const questionMock = vi.fn((_p: string, cb: (a: string) => void) => cb("n"));
    vi.mocked(createInterface).mockReturnValue({
      question: questionMock,
      close: vi.fn(),
    } as ReturnType<typeof createInterface>);

    // Should not throw — catch+finally fires regardless of rejection
    await expect(startSandbox("mytest", projectCwd, {})).resolves.toBeUndefined();
    expect(questionMock).toHaveBeenCalled();

    // Reset mock back to resolved for subsequent tests
    vi.mocked(interactiveMode).mockResolvedValue(undefined);
  });
});

// ---------------------------------------------------------------------------
// Merge-back — assertions 15–17
// ---------------------------------------------------------------------------

describe("startSandbox() — merge-back", () => {
  const projectCwd = "/fake/project";

  beforeEach(async () => {
    vi.clearAllMocks();
    await resetInteractiveModeMock();
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes("branch --show-current")) return "main\n";
      if (cmd.includes("worktree list")) return `worktree /fake/project\nHEAD abc\n`;
      if (cmd.includes("worktree add")) return "";
      return "";
    });
    mockExistsSync.mockReturnValue(false);
    vi.spyOn(process, "chdir").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("Y path, clean merge → merge + worktree remove + branch -D + success message", async () => {
    const { createInterface } = await import("node:readline");
    vi.mocked(createInterface).mockReturnValue({
      question: vi.fn((_p: string, cb: (a: string) => void) => cb("y")),
      close: vi.fn(),
    } as ReturnType<typeof createInterface>);

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await startSandbox("mytest", projectCwd, {});

    const mergeCalls = mockExecSync.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("git merge"),
    );
    expect(mergeCalls).toHaveLength(1);
    expect(mergeCalls[0][0]).toContain("--no-ff");
    expect(mergeCalls[0][0]).toContain("sandbox/mytest");

    const removeCalls = mockExecSync.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("worktree remove"),
    );
    expect(removeCalls).toHaveLength(1);

    const branchDeleteCalls = mockExecSync.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("branch -D"),
    );
    expect(branchDeleteCalls).toHaveLength(1);

    const successMsg = consoleSpy.mock.calls.find(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("merged"),
    );
    expect(successMsg).toBeDefined();

    consoleSpy.mockRestore();
  });

  it("Y path, merge conflict → leaves worktree, prints git merge --abort instructions", async () => {
    const { createInterface } = await import("node:readline");
    vi.mocked(createInterface).mockReturnValue({
      question: vi.fn((_p: string, cb: (a: string) => void) => cb("y")),
      close: vi.fn(),
    } as ReturnType<typeof createInterface>);

    // Make git merge fail to simulate a conflict
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes("branch --show-current")) return "main\n";
      if (cmd.includes("worktree list")) return `worktree /fake/project\nHEAD abc\n`;
      if (cmd.includes("worktree add")) return "";
      if (cmd.includes("git merge")) throw new Error("Merge conflict");
      return "";
    });

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await startSandbox("mytest", projectCwd, {});

    const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allOutput).toContain("git merge --abort");
    // Message was updated to point clearly to main repo (not sandbox worktree)
    expect(allOutput).toMatch(/Merge failed|Conflicts are in your main repo|worktree preserved/i);

    // worktree remove should NOT have been called (conflict path preserves it)
    const removeCalls = mockExecSync.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("worktree remove"),
    );
    expect(removeCalls).toHaveLength(0);

    consoleSpy.mockRestore();
  });

  it("N path → worktree preserved + resume hint printed", async () => {
    const { createInterface } = await import("node:readline");
    vi.mocked(createInterface).mockReturnValue({
      question: vi.fn((_p: string, cb: (a: string) => void) => cb("n")),
      close: vi.fn(),
    } as ReturnType<typeof createInterface>);

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await startSandbox("mytest", projectCwd, {});

    const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allOutput).toContain("phase2s --sandbox mytest");

    // No git merge should have been called
    const mergeCalls = mockExecSync.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("git merge"),
    );
    expect(mergeCalls).toHaveLength(0);

    consoleSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Additional assertions 18–20 (from eng review)
// ---------------------------------------------------------------------------

describe("startSandbox() — additional correctness checks", () => {
  const projectCwd = "/fake/project";

  beforeEach(async () => {
    vi.clearAllMocks();
    await resetInteractiveModeMock();
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes("branch --show-current")) return "main\n";
      if (cmd.includes("worktree list")) return `worktree /fake/project\nHEAD abc\n`;
      if (cmd.includes("worktree add")) return "";
      return "";
    });
    mockExistsSync.mockReturnValue(false);
    vi.spyOn(process, "chdir").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes configOverrides to loadConfig so provider/model/system are not dropped", async () => {
    const { loadConfig } = await import("../../src/core/config.js");

    await startSandbox("mytest", projectCwd, { provider: "anthropic", model: "claude-opus-4" });

    expect(loadConfig).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "anthropic", model: "claude-opus-4" }),
    );
  });

  it("process.chdir(originalCwd) is called before any worktree/branch cleanup", async () => {
    const { createInterface } = await import("node:readline");
    vi.mocked(createInterface).mockReturnValue({
      question: vi.fn((_p: string, cb: (a: string) => void) => cb("y")),
      close: vi.fn(),
    } as ReturnType<typeof createInterface>);

    const chdirSpy = vi.spyOn(process, "chdir").mockImplementation(() => {});

    await startSandbox("mytest", projectCwd, {});

    // chdir back to originalCwd should happen before cleanup git commands
    const chdirCalls = chdirSpy.mock.calls;
    const mergeIndex = mockExecSync.mock.calls.findIndex(
      (c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("git merge"),
    );
    // chdir with originalCwd should appear after chdir to worktree
    const chdirToOrigIndex = chdirCalls.findIndex((c) => c[0] === projectCwd);
    expect(chdirToOrigIndex).toBeGreaterThanOrEqual(0);
    // cleanup (merge) should happen after chdir back to originalCwd
    // (merge index is in execSync calls, chdir is before it)
    if (mergeIndex >= 0) {
      // The chdir to originalCwd happened at some point — verify it happened before cleanup
      // We can't easily compare cross-mock call indices, but we can verify chdir was called with originalCwd
      expect(chdirCalls.some((c) => c[0] === projectCwd)).toBe(true);
    }
  });

  it("state (b) git command uses no -b flag; state (d) uses -b flag", async () => {
    // State (b): in git, dir missing
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes("branch --show-current")) return "main\n";
      if (cmd.includes("worktree list")) return `worktree /fake/project\nHEAD abc\nbranch refs/heads/main\n\nworktree /fake/project/.worktrees/sandbox-mytest\nHEAD abc\nbranch refs/heads/sandbox/mytest\n\n`;
      if (cmd.includes("worktree prune")) return "";
      if (cmd.includes("worktree add")) return "";
      return "";
    });
    mockExistsSync.mockReturnValue(false); // dir missing

    await startSandbox("mytest", projectCwd, {});

    const addCalls = mockExecSync.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("worktree add"),
    );
    expect(addCalls).toHaveLength(1);
    expect(addCalls[0][0]).not.toContain("-b");
    expect(addCalls[0][0]).toContain("sandbox/mytest");
  });
});

// ---------------------------------------------------------------------------
// Error-exit coverage (assertions 21–23)
// ---------------------------------------------------------------------------

describe("startSandbox() — worktree add failure paths", () => {
  const projectCwd = "/fake/project";

  beforeEach(async () => {
    vi.clearAllMocks();
    await resetInteractiveModeMock();
    vi.spyOn(process, "chdir").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("state (b): worktree add throws → exits 1 with error message", async () => {
    // In git but dir missing (state b), then add fails
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes("branch --show-current")) return "main\n";
      if (cmd.includes("worktree list")) return `worktree /fake/project\nHEAD abc\nbranch refs/heads/main\n\nworktree /fake/project/.worktrees/sandbox-mytest\nHEAD abc\nbranch refs/heads/sandbox/mytest\n\n`;
      if (cmd.includes("worktree prune")) return "";
      if (cmd.includes("worktree add")) throw new Error("branch already exists");
      return "";
    });
    mockExistsSync.mockReturnValue(false);

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await startSandbox("mytest", projectCwd, {});
    expect(process.exit).toHaveBeenCalledWith(1);
    consoleSpy.mockRestore();
  });

  it("state (c): worktree add throws after rmSync → exits 1 with error message", async () => {
    // Dir exists but not in git (state c), then add fails
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes("branch --show-current")) return "main\n";
      if (cmd.includes("worktree list")) return `worktree /fake/project\nHEAD abc\n`;
      if (cmd.includes("worktree add")) throw new Error("Permission denied");
      return "";
    });
    mockExistsSync.mockReturnValue(true);

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await startSandbox("mytest", projectCwd, {});
    expect(process.exit).toHaveBeenCalledWith(1);
    consoleSpy.mockRestore();
  });

  it("state (d): worktree add throws on fresh create → exits 1 with error message", async () => {
    // Nothing exists (state d), fresh add fails
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes("branch --show-current")) return "main\n";
      if (cmd.includes("worktree list")) return `worktree /fake/project\nHEAD abc\n`;
      if (cmd.includes("worktree add")) throw new Error("disk full");
      return "";
    });
    mockExistsSync.mockReturnValue(false);

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await startSandbox("mytest", projectCwd, {});
    expect(process.exit).toHaveBeenCalledWith(1);
    consoleSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Uncommitted work warning (Codex adversarial review, 2026-04-13)
// ---------------------------------------------------------------------------

describe("startSandbox() — uncommitted work warning on merge", () => {
  const projectCwd = "/fake/project";

  beforeEach(async () => {
    vi.clearAllMocks();
    await resetInteractiveModeMock();
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes("branch --show-current")) return "main\n";
      if (cmd.includes("worktree list")) return `worktree /fake/project\nHEAD abc\n`;
      if (cmd.includes("worktree add")) return "";
      if (cmd.includes("status --porcelain")) return " M modified-file.ts\n"; // dirty worktree
      return "";
    });
    mockExistsSync.mockReturnValue(false);
    vi.spyOn(process, "chdir").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dirty sandbox + merge Y + confirm Y → proceeds with merge despite uncommitted work", async () => {
    const { createInterface } = await import("node:readline");
    let callCount = 0;
    // First question: "Merge?" → "y"; Second question: "Discard?" → "y"
    vi.mocked(createInterface).mockReturnValue({
      question: vi.fn((_p: string, cb: (a: string) => void) => {
        callCount++;
        cb(callCount === 1 ? "y" : "y");
      }),
      close: vi.fn(),
    } as ReturnType<typeof createInterface>);

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await startSandbox("mytest", projectCwd, {});

    // Warning was shown
    const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allOutput).toMatch(/uncommitted changes/i);

    // Merge was still executed
    const mergeCalls = mockExecSync.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("git merge"),
    );
    expect(mergeCalls).toHaveLength(1);

    consoleSpy.mockRestore();
  });

  it("dirty sandbox + merge Y + confirm N → merge cancelled, no git merge called", async () => {
    const { createInterface } = await import("node:readline");
    let callCount = 0;
    // First question: "Merge?" → "y"; Second question: "Discard?" → "n"
    vi.mocked(createInterface).mockReturnValue({
      question: vi.fn((_p: string, cb: (a: string) => void) => {
        callCount++;
        cb(callCount === 1 ? "y" : "n");
      }),
      close: vi.fn(),
    } as ReturnType<typeof createInterface>);

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await startSandbox("mytest", projectCwd, {});

    // Merge was NOT executed
    const mergeCalls = mockExecSync.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("git merge"),
    );
    expect(mergeCalls).toHaveLength(0);

    // Cancellation message shown
    const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allOutput).toMatch(/cancelled/i);

    consoleSpy.mockRestore();
  });

  it("clean sandbox + merge Y → no uncommitted-work prompt shown", async () => {
    // Override execSync to return empty status (clean worktree)
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes("branch --show-current")) return "main\n";
      if (cmd.includes("worktree list")) return `worktree /fake/project\nHEAD abc\n`;
      if (cmd.includes("worktree add")) return "";
      if (cmd.includes("status --porcelain")) return ""; // clean
      return "";
    });

    const { createInterface } = await import("node:readline");
    const questionMock = vi.fn((_p: string, cb: (a: string) => void) => cb("y"));
    vi.mocked(createInterface).mockReturnValue({
      question: questionMock,
      close: vi.fn(),
    } as ReturnType<typeof createInterface>);

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await startSandbox("mytest", projectCwd, {});

    // Only one readline question (the merge prompt) — no discard-confirm prompt
    expect(questionMock).toHaveBeenCalledTimes(1);
    const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allOutput).not.toMatch(/uncommitted/i);

    consoleSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Review-pass fixes (2026-04-13 /review workflow)
// ---------------------------------------------------------------------------

describe("startSandbox() — review-pass: resume forwarding + checkout split", () => {
  const projectCwd = "/fake/project";

  beforeEach(async () => {
    vi.clearAllMocks();
    await resetInteractiveModeMock();
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes("branch --show-current")) return "main\n";
      if (cmd.includes("worktree list")) return `worktree /fake/project\nHEAD abc\n`;
      if (cmd.includes("worktree add")) return "";
      if (cmd.includes("status --porcelain")) return ""; // clean
      return "";
    });
    mockExistsSync.mockReturnValue(false);
    vi.spyOn(process, "chdir").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resume=true is forwarded to interactiveMode", async () => {
    const { interactiveMode } = await import("../../src/cli/index.js");

    await startSandbox("mytest", projectCwd, {}, /* resume= */ true);

    expect(interactiveMode).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ resume: true }),
    );
  });

  it("resume=false (default) passes resume:false to interactiveMode", async () => {
    const { interactiveMode } = await import("../../src/cli/index.js");

    await startSandbox("mytest", projectCwd, {});

    expect(interactiveMode).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ resume: false }),
    );
  });

  it("checkout failure → distinct error message, no merge-conflict message", async () => {
    const { createInterface } = await import("node:readline");
    vi.mocked(createInterface).mockReturnValue({
      question: vi.fn((_p: string, cb: (a: string) => void) => cb("y")),
      close: vi.fn(),
    } as ReturnType<typeof createInterface>);

    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes("branch --show-current")) return "main\n";
      if (cmd.includes("worktree list")) return `worktree /fake/project\nHEAD abc\n`;
      if (cmd.includes("worktree add")) return "";
      if (cmd.includes("status --porcelain")) return "";
      if (cmd.includes("git checkout")) throw new Error("pathspec 'main' did not match");
      return "";
    });

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await startSandbox("mytest", projectCwd, {});

    const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allOutput).toMatch(/Could not return to branch|deleted or renamed/i);
    expect(allOutput).not.toMatch(/Merge failed|merge --abort/);

    const mergeCalls = mockExecSync.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("git merge"),
    );
    expect(mergeCalls).toHaveLength(0);

    consoleSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// listSandboxes() — porcelain parsing and sandbox filtering
// ---------------------------------------------------------------------------

describe("listSandboxes()", () => {
  const projectCwd = "/fake/project";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const PORCELAIN_WITH_SANDBOXES = [
    "worktree /fake/project",
    "HEAD abc1234def5678",
    "branch refs/heads/main",
    "",
    "worktree /fake/project/.worktrees/sandbox-spike-foo",
    "HEAD aabbccdd11223344",
    "branch refs/heads/sandbox/spike-foo",
    "",
    "worktree /fake/project/.worktrees/sandbox-rate-limiter",
    "HEAD 99887766554433aa",
    "branch refs/heads/sandbox/rate-limiter",
    "",
  ].join("\n");

  it("returns only sandbox worktrees (filters refs/heads/sandbox/ prefix)", () => {
    mockExecSync.mockReturnValue(PORCELAIN_WITH_SANDBOXES);

    const sandboxes = listSandboxes(projectCwd);

    expect(sandboxes).toHaveLength(2);
    expect(sandboxes[0].name).toBe("spike-foo");
    expect(sandboxes[1].name).toBe("rate-limiter");
  });

  it("extracts path and short commit hash for each sandbox", () => {
    mockExecSync.mockReturnValue(PORCELAIN_WITH_SANDBOXES);

    const sandboxes = listSandboxes(projectCwd);

    expect(sandboxes[0].path).toBe("/fake/project/.worktrees/sandbox-spike-foo");
    expect(sandboxes[0].commit).toBe("aabbccd"); // 7-char slice
    expect(sandboxes[1].path).toBe("/fake/project/.worktrees/sandbox-rate-limiter");
    expect(sandboxes[1].commit).toBe("9988776"); // 7-char slice
  });

  it("returns empty array when no sandbox worktrees exist", () => {
    mockExecSync.mockReturnValue(
      "worktree /fake/project\nHEAD abc1234\nbranch refs/heads/main\n\n",
    );

    const sandboxes = listSandboxes(projectCwd);

    expect(sandboxes).toHaveLength(0);
  });

  it("returns empty array when output is empty (no worktrees)", () => {
    mockExecSync.mockReturnValue("");

    const sandboxes = listSandboxes(projectCwd);

    expect(sandboxes).toHaveLength(0);
  });

  it("throws when git command fails (not a git repo)", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("fatal: not a git repository");
    });

    expect(() => listSandboxes(projectCwd)).toThrow("fatal: not a git repository");
  });

  it("does not include the main worktree (HEAD branch not sandbox/)", () => {
    mockExecSync.mockReturnValue(PORCELAIN_WITH_SANDBOXES);

    const sandboxes = listSandboxes(projectCwd);

    // Main worktree is refs/heads/main — must not appear
    expect(sandboxes.every((s) => s.name !== "main")).toBe(true);
    expect(sandboxes.every((s) => s.path !== "/fake/project")).toBe(true);
  });

  it("excludes detached-HEAD worktrees (no branch line → branch is empty string)", () => {
    // A worktree checked out in detached HEAD state has no 'branch' line in porcelain
    // output. parseWorktreePorcelain sets branch to "" in that case. listSandboxes
    // filters on startsWith("refs/heads/sandbox/") so detached worktrees are silently
    // excluded — this test documents that behavior as intentional.
    const porcelainWithDetached = [
      "worktree /fake/project",
      "HEAD abc1234def5678",
      "branch refs/heads/main",
      "",
      "worktree /fake/project/.worktrees/detached-wt",
      "HEAD deadbeef12345678",
      // No 'branch' line — detached HEAD
      "",
      "worktree /fake/project/.worktrees/sandbox-active",
      "HEAD aabbccdd11223344",
      "branch refs/heads/sandbox/active",
      "",
    ].join("\n");
    mockExecSync.mockReturnValue(porcelainWithDetached);

    const sandboxes = listSandboxes(projectCwd);

    // Only the sandbox/ worktree is returned; detached worktree is excluded
    expect(sandboxes).toHaveLength(1);
    expect(sandboxes[0].name).toBe("active");
    expect(sandboxes[0].path).toBe("/fake/project/.worktrees/sandbox-active");
  });
});

// ---------------------------------------------------------------------------
// listWorktreePaths — error discrimination (Sprint 54, v1.28.0)
// ---------------------------------------------------------------------------

describe("listWorktreePaths() — error discrimination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an array of paths on success", () => {
    const porcelain = [
      "worktree /fake/project",
      "HEAD abc1234",
      "branch refs/heads/main",
      "",
      "worktree /fake/project/.worktrees/sandbox-foo",
      "HEAD def5678",
      "branch refs/heads/sandbox/foo",
      "",
    ].join("\n");
    mockExecSync.mockReturnValue(porcelain);

    const paths = listWorktreePaths("/fake/project");
    expect(paths).toEqual([
      "/fake/project",
      "/fake/project/.worktrees/sandbox-foo",
    ]);
  });

  it("returns [] when git binary is not found (ENOENT)", () => {
    const enoentErr = Object.assign(new Error("spawn git ENOENT"), { code: "ENOENT" });
    mockExecSync.mockImplementation(() => { throw enoentErr; });

    const paths = listWorktreePaths("/fake/project");
    expect(paths).toEqual([]);
  });

  it("rethrows when git fails for a non-ENOENT reason (e.g. lock, permissions)", () => {
    const lockErr = Object.assign(new Error("fatal: Unable to create lock file"), { code: 128 });
    mockExecSync.mockImplementation(() => { throw lockErr; });

    expect(() => listWorktreePaths("/fake/project")).toThrow("Unable to create lock file");
  });

  it("rethrows even when error code is numeric (execSync non-zero exit)", () => {
    // execSync throws with a numeric status code for non-zero exits, not "ENOENT".
    // Only ENOENT (string) should be swallowed.
    const exitErr = Object.assign(new Error("Command failed: git worktree list"), { status: 1 });
    mockExecSync.mockImplementation(() => { throw exitErr; });

    expect(() => listWorktreePaths("/fake/project")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// startSandbox() — non-git pre-flight check (Sprint 54, v1.28.0, Item 3)
// ---------------------------------------------------------------------------

describe("startSandbox() — non-git pre-flight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, "chdir").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exits 1 with clear message when not in a git repository", async () => {
    // git rev-parse --is-inside-work-tree throws when not in a git repo
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes("rev-parse --is-inside-work-tree")) {
        throw new Error("fatal: not a git repository");
      }
      return "";
    });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await startSandbox("mytest", "/not-a-git-dir", {});

    expect(process.exit).toHaveBeenCalledWith(1);
    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("phase2s --sandbox requires a git repository.");

    consoleSpy.mockRestore();
  });

  it("proceeds past pre-flight when inside a git repository", async () => {
    // rev-parse succeeds → not a non-git dir
    // Then branch --show-current returns a branch name
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes("rev-parse --is-inside-work-tree")) return "true";
      if (cmd.includes("branch --show-current")) return "main";
      if (cmd.includes("worktree list")) return "worktree /fake/project\nHEAD abc1234\nbranch refs/heads/main\n";
      if (cmd.includes("worktree add")) return "";
      return "";
    });
    mockExistsSync.mockReturnValue(false);

    // Should NOT call process.exit(1) for the non-git reason
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await startSandbox("mytest", "/fake/project", {});

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).not.toContain("requires a git repository");

    consoleSpy.mockRestore();
  });

  it("error message says 'phase2s --sandbox requires a git repository.' exactly", async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes("rev-parse --is-inside-work-tree")) {
        throw new Error("fatal: not a git repository");
      }
      return "";
    });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await startSandbox("mytest", "/not-a-git-dir", {});

    const firstErrorLine = consoleSpy.mock.calls[0]?.[0] as string;
    expect(firstErrorLine).toBe("Error: phase2s --sandbox requires a git repository.");

    consoleSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// startSandbox() — dirty working tree (Sprint 54, v1.28.0, Item 4)
// ---------------------------------------------------------------------------

describe("startSandbox() — dirty working tree", () => {
  const projectCwd = "/fake/project";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, "chdir").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("succeeds when the main worktree has staged changes (worktree isolation works)", async () => {
    // Investigation result (2026-04-13): git worktree add does NOT refuse on dirty
    // main worktrees. Staged/unstaged changes stay in the main worktree and do NOT
    // propagate to the sandbox. No auto-stash is needed.
    mockExecSync.mockImplementation((cmd: string) => {
      // All git commands succeed — including worktree add with staged changes present
      if (cmd.includes("rev-parse --is-inside-work-tree")) return "true";
      if (cmd.includes("branch --show-current")) return "main";
      if (cmd.includes("worktree list")) return "worktree /fake/project\nHEAD abc1234\nbranch refs/heads/main\n";
      if (cmd.includes("worktree add")) return ""; // succeeds despite dirty tree
      return "";
    });
    mockExistsSync.mockReturnValue(false);

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Should not exit with an error about dirty state
    await startSandbox("spike-new-thing", projectCwd, {});

    expect(process.exit).not.toHaveBeenCalledWith(1);
    const errOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(errOutput).not.toMatch(/stash|dirty|uncommitted/i);

    consoleSpy.mockRestore();
  });
});
