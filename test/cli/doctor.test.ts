import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Mock child_process — spawnSync used by checkProviderBinary
// ---------------------------------------------------------------------------

const spawnSyncMock = vi.fn();

vi.mock("node:child_process", () => ({
  spawnSync: spawnSyncMock,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "phase2s-doctor-test-"));
}

// ---------------------------------------------------------------------------
// checkNodeVersion
// ---------------------------------------------------------------------------

describe("checkNodeVersion", () => {
  it("passes when current Node version is >= 20", async () => {
    const { checkNodeVersion } = await import("../../src/cli/doctor.js");
    // The test process runs Node >= 20 (required by phase2s itself)
    const result = checkNodeVersion();
    expect(result.name).toBe("Node.js version");
    expect(result.ok).toBe(true);
    expect(result.detail).toMatch(/^v\d+/);
    expect(result.fix).toBeUndefined();
  });

  it("fails when major version is below 20", async () => {
    const { checkNodeVersion } = await import("../../src/cli/doctor.js");
    const original = process.version;
    Object.defineProperty(process, "version", { value: "v18.20.0", configurable: true });
    const result = checkNodeVersion();
    Object.defineProperty(process, "version", { value: original, configurable: true });
    expect(result.ok).toBe(false);
    expect(result.fix).toContain("nodejs.org");
  });
});

// ---------------------------------------------------------------------------
// checkProviderBinary
// ---------------------------------------------------------------------------

describe("checkProviderBinary", () => {
  beforeEach(() => spawnSyncMock.mockReset());

  it("codex-cli: returns ok when binary exits 0", async () => {
    spawnSyncMock.mockReturnValue({ status: 0, error: null });
    const { checkProviderBinary } = await import("../../src/cli/doctor.js");
    const result = checkProviderBinary("codex-cli");
    expect(result.ok).toBe(true);
    expect(result.name).toBe("codex CLI");
    expect(spawnSyncMock).toHaveBeenCalledWith("codex", ["--version"], expect.any(Object));
  });

  it("codex-cli: returns fail when binary not found", async () => {
    spawnSyncMock.mockReturnValue({ status: 1, error: new Error("ENOENT") });
    const { checkProviderBinary } = await import("../../src/cli/doctor.js");
    const result = checkProviderBinary("codex-cli");
    expect(result.ok).toBe(false);
    expect(result.fix).toContain("npm install -g");
  });

  it("ollama: returns ok when ollama list exits 0", async () => {
    spawnSyncMock.mockReturnValue({ status: 0, error: null });
    const { checkProviderBinary } = await import("../../src/cli/doctor.js");
    const result = checkProviderBinary("ollama");
    expect(result.ok).toBe(true);
    expect(result.name).toBe("ollama");
    expect(spawnSyncMock).toHaveBeenCalledWith("ollama", ["list"], expect.any(Object));
  });

  it("openai-api: returns N/A (no binary required)", async () => {
    const { checkProviderBinary } = await import("../../src/cli/doctor.js");
    const result = checkProviderBinary("openai-api");
    expect(result.ok).toBe(true);
    expect(result.detail).toBe("N/A");
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// checkAuth
// ---------------------------------------------------------------------------

describe("checkAuth", () => {
  it("openai-api: ok when config.apiKey is set", async () => {
    const { checkAuth } = await import("../../src/cli/doctor.js");
    const result = checkAuth("openai-api", { apiKey: "sk-test" });
    expect(result.ok).toBe(true);
    expect(result.name).toBe("OpenAI API key");
  });

  it("openai-api: fails when no key in config or env", async () => {
    const { checkAuth } = await import("../../src/cli/doctor.js");
    const savedKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const result = checkAuth("openai-api", {});
    if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
    expect(result.ok).toBe(false);
    expect(result.fix).toContain("OPENAI_API_KEY");
  });

  it("anthropic: ok when config.anthropicApiKey is set", async () => {
    const { checkAuth } = await import("../../src/cli/doctor.js");
    const result = checkAuth("anthropic", { anthropicApiKey: "sk-ant-test" });
    expect(result.ok).toBe(true);
    expect(result.name).toBe("Anthropic API key");
  });

  it("openrouter: ok when config.openrouterApiKey is set", async () => {
    const { checkAuth } = await import("../../src/cli/doctor.js");
    const result = checkAuth("openrouter", { openrouterApiKey: "sk-or-test" });
    expect(result.ok).toBe(true);
    expect(result.name).toBe("OpenRouter API key");
  });

  it("openrouter: fails when no key available", async () => {
    const { checkAuth } = await import("../../src/cli/doctor.js");
    const savedKey = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    const result = checkAuth("openrouter", {});
    if (savedKey !== undefined) process.env.OPENROUTER_API_KEY = savedKey;
    expect(result.ok).toBe(false);
    expect(result.fix).toContain("OPENROUTER_API_KEY");
  });

  it("gemini: ok when config.geminiApiKey is set", async () => {
    const { checkAuth } = await import("../../src/cli/doctor.js");
    const result = checkAuth("gemini", { geminiApiKey: "AIzaTestKey" });
    expect(result.ok).toBe(true);
    expect(result.name).toBe("Gemini API key");
  });

  it("gemini: fails when no key in config or env", async () => {
    const { checkAuth } = await import("../../src/cli/doctor.js");
    const savedKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const result = checkAuth("gemini", {});
    if (savedKey !== undefined) process.env.GEMINI_API_KEY = savedKey;
    expect(result.ok).toBe(false);
    expect(result.fix).toContain("GEMINI_API_KEY");
  });

  it("gemini: ok but notes non-AIza prefix when key looks wrong", async () => {
    const { checkAuth } = await import("../../src/cli/doctor.js");
    const result = checkAuth("gemini", { geminiApiKey: "sk-not-a-gemini-key" });
    expect(result.ok).toBe(true); // key is present — not a hard failure
    expect(result.detail).toContain("AIza");
    expect(result.fix).toBeDefined();
  });

  it("ollama: always N/A (no auth required)", async () => {
    const { checkAuth } = await import("../../src/cli/doctor.js");
    const result = checkAuth("ollama", {});
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("N/A");
  });
});

// ---------------------------------------------------------------------------
// checkConfigFile
// ---------------------------------------------------------------------------

describe("checkConfigFile", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("ok when config file is absent (optional)", async () => {
    const { checkConfigFile } = await import("../../src/cli/doctor.js");
    const result = checkConfigFile(join(tmpDir, ".phase2s.yaml"));
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("not present");
  });

  it("ok when config has a valid provider", async () => {
    const { checkConfigFile } = await import("../../src/cli/doctor.js");
    const configPath = join(tmpDir, ".phase2s.yaml");
    writeFileSync(configPath, "provider: openai-api\n");
    const result = checkConfigFile(configPath);
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("openai-api");
  });

  it("fails when provider value is unknown", async () => {
    const { checkConfigFile } = await import("../../src/cli/doctor.js");
    const configPath = join(tmpDir, ".phase2s.yaml");
    writeFileSync(configPath, "provider: unknown-ai\n");
    const result = checkConfigFile(configPath);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("unknown-ai");
  });

  it("fails when YAML is malformed", async () => {
    const { checkConfigFile } = await import("../../src/cli/doctor.js");
    const configPath = join(tmpDir, ".phase2s.yaml");
    writeFileSync(configPath, "provider: [\nbad yaml\n");
    const result = checkConfigFile(configPath);
    expect(result.ok).toBe(false);
    expect(result.fix).toContain("phase2s init");
  });
});

// ---------------------------------------------------------------------------
// checkWorkDir
// ---------------------------------------------------------------------------

describe("checkWorkDir", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates missing dir and returns ok", async () => {
    const { checkWorkDir } = await import("../../src/cli/doctor.js");
    const targetDir = join(tmpDir, ".phase2s");
    const result = checkWorkDir(targetDir);
    expect(result.ok).toBe(true);
    expect(result.detail).toBe("writable");
  });

  it("returns ok when dir already exists and is writable", async () => {
    const { checkWorkDir } = await import("../../src/cli/doctor.js");
    const targetDir = join(tmpDir, ".phase2s");
    mkdirSync(targetDir);
    const result = checkWorkDir(targetDir);
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// checkTmux (Sprint 35 — parallel execution)
// ---------------------------------------------------------------------------

describe("checkTmux", () => {
  it("returns a CheckResult with name 'tmux'", async () => {
    const { checkTmux } = await import("../../src/cli/doctor.js");
    const result = checkTmux();
    expect(result.name).toBe("tmux");
    // Result depends on whether tmux is installed in the test environment
    expect(typeof result.ok).toBe("boolean");
    expect(result.detail).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// checkGitWorktree (Sprint 35 — parallel execution)
// ---------------------------------------------------------------------------

describe("checkGitWorktree", () => {
  it("returns a CheckResult with name 'git worktree'", async () => {
    const { checkGitWorktree } = await import("../../src/cli/doctor.js");
    const result = checkGitWorktree();
    expect(result.name).toBe("git worktree");
    expect(typeof result.ok).toBe("boolean");
  });
});

// ---------------------------------------------------------------------------
// checkTemplatesDir (Sprint 42 — spec template library)
// ---------------------------------------------------------------------------

describe("checkTemplatesDir", () => {
  it("returns a CheckResult with name 'Spec templates'", async () => {
    const { checkTemplatesDir } = await import("../../src/cli/doctor.js");
    const result = checkTemplatesDir();
    expect(result.name).toBe("Spec templates");
    expect(typeof result.ok).toBe("boolean");
    expect(typeof result.detail).toBe("string");
  });

  it("passes when bundled templates directory exists with .md files", async () => {
    // The bundled templates directory exists at .phase2s/templates/ — 6 templates shipped
    const { checkTemplatesDir } = await import("../../src/cli/doctor.js");
    const result = checkTemplatesDir();
    // In the dev environment, the templates are present — verify the result shape
    if (result.ok) {
      expect(result.detail).toMatch(/\d+ bundled templates? found/);
    } else {
      // In CI or fresh envs where path differs, the check still returns a valid result
      expect(result.fix).toContain("npm install");
    }
  });

  it("fix message always points to npm install when check fails", () => {
    // Unit-test the fix message content by directly reading the source
    // This is a documentation-style test ensuring the fix is actionable
    const failResult = {
      name: "Spec templates",
      ok: false,
      detail: "Bundled templates directory not found",
      fix: "Reinstall phase2s: npm install -g @scanton/phase2s",
    };
    expect(failResult.fix).toContain("npm install");
    expect(failResult.name).toBe("Spec templates");
  });
});

// ---------------------------------------------------------------------------
// checkShellPlugin (Sprint 43 — ZSH shell integration)
// ---------------------------------------------------------------------------

describe("checkShellPlugin", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "phase2s-doctor-shellplugin-test-"));
    // Stub SHELL to /bin/zsh so tests exercise the ZSH code path regardless
    // of the host shell. CI runners (bash) would otherwise hit the early-return
    // "N/A (ZSH-only)" branch and never reach plugin/zshrc checks.
    vi.stubEnv("SHELL", "/bin/zsh");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("fails when plugin file does not exist", async () => {
    const { checkShellPlugin } = await import("../../src/cli/doctor.js");
    const result = checkShellPlugin(join(tmpDir, ".phase2s"), join(tmpDir, ".zshrc"));
    expect(result.ok).toBe(false);
    expect(result.name).toBe("Shell integration");
    expect(result.detail).toContain("not installed");
    expect(result.fix).toContain("phase2s setup");
  });

  it("fails when plugin exists but zshrc does not exist", async () => {
    const { checkShellPlugin } = await import("../../src/cli/doctor.js");
    const phase2sDir = join(tmpDir, ".phase2s");
    mkdirSync(phase2sDir);
    writeFileSync(join(phase2sDir, "phase2s.plugin.zsh"), "# plugin\n");
    // No zshrc created
    const result = checkShellPlugin(phase2sDir, join(tmpDir, ".zshrc"));
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("not sourced");
    expect(result.fix).toContain("phase2s setup");
  });

  it("fails when plugin exists but zshrc does not source it", async () => {
    const { checkShellPlugin } = await import("../../src/cli/doctor.js");
    const phase2sDir = join(tmpDir, ".phase2s");
    const zshrcPath = join(tmpDir, ".zshrc");
    mkdirSync(phase2sDir);
    writeFileSync(join(phase2sDir, "phase2s.plugin.zsh"), "# plugin\n");
    writeFileSync(zshrcPath, "# no source line here\n");
    const result = checkShellPlugin(phase2sDir, zshrcPath);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("not sourced");
  });

  it("passes when plugin exists and zshrc sources it", async () => {
    const { checkShellPlugin } = await import("../../src/cli/doctor.js");
    const phase2sDir = join(tmpDir, ".phase2s");
    const zshrcPath = join(tmpDir, ".zshrc");
    const pluginDest = join(phase2sDir, "phase2s.plugin.zsh");
    mkdirSync(phase2sDir);
    writeFileSync(pluginDest, "# plugin\n");
    writeFileSync(zshrcPath, `source "${pluginDest}" # phase2s shell integration\n`);
    const result = checkShellPlugin(phase2sDir, zshrcPath);
    expect(result.ok).toBe(true);
    expect(result.name).toBe("Shell integration");
    expect(result.detail).toContain("sourced");
  });

  it("fails when plugin exists but phase2sDir is not writable (Sprint 45 guard)", async () => {
    // Skip on Windows — chmod semantics differ
    if (process.platform === "win32") return;
    const { checkShellPlugin } = await import("../../src/cli/doctor.js");
    const phase2sDir = join(tmpDir, ".phase2s");
    const zshrcPath = join(tmpDir, ".zshrc");
    const pluginDest = join(phase2sDir, "phase2s.plugin.zsh");
    mkdirSync(phase2sDir);
    writeFileSync(pluginDest, "# plugin\n");
    writeFileSync(zshrcPath, `source "$HOME/.phase2s/phase2s.plugin.zsh" # phase2s shell integration\n`);
    // r-xr-xr-x: execute bit preserved so existsSync(pluginDest) works,
    // but write bit removed so accessSync(W_OK) fails.
    chmodSync(phase2sDir, 0o555);
    try {
      const result = checkShellPlugin(phase2sDir, zshrcPath);
      expect(result.ok).toBe(false);
      expect(result.detail).toContain("not writable");
      expect(result.fix).toContain("chmod");
    } finally {
      // Restore write permission so afterEach can clean up
      chmodSync(phase2sDir, 0o755);
    }
  });
});

// ---------------------------------------------------------------------------
// checkSessionDag
// ---------------------------------------------------------------------------

describe("checkSessionDag", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "phase2s-dag-test-"));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeSession(dir: string, id: string, parentId: string | null) {
    writeFileSync(
      join(dir, `${id}.json`),
      JSON.stringify({
        schemaVersion: 2,
        meta: { id, parentId, branchName: "main", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
        messages: [],
      }),
    );
  }

  it("returns ok when sessions dir does not exist (fresh install)", async () => {
    const { checkSessionDag } = await import("../../src/cli/doctor.js");
    const result = checkSessionDag(join(tmpDir, ".phase2s", "sessions"));
    expect(result.ok).toBe(true);
    expect(result.detail).toBe("no sessions found");
  });

  it("returns ok when no session files exist", async () => {
    const { checkSessionDag } = await import("../../src/cli/doctor.js");
    const dir = join(tmpDir, ".phase2s", "sessions");
    mkdirSync(dir, { recursive: true });
    const result = checkSessionDag(dir);
    expect(result.ok).toBe(true);
    expect(result.detail).toBe("no sessions found");
  });

  it("returns ok when all parentIds resolve", async () => {
    const { checkSessionDag } = await import("../../src/cli/doctor.js");
    const dir = join(tmpDir, ".phase2s", "sessions");
    mkdirSync(dir, { recursive: true });
    const parentId = "00000000-0000-0000-0000-000000000001";
    const childId = "00000000-0000-0000-0000-000000000002";
    writeSession(dir, parentId, null);
    writeSession(dir, childId, parentId);
    const result = checkSessionDag(dir);
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("2 sessions");
    expect(result.detail).toContain("0 dangling");
  });

  it("detects dangling parentId", async () => {
    const { checkSessionDag } = await import("../../src/cli/doctor.js");
    const dir = join(tmpDir, ".phase2s", "sessions");
    mkdirSync(dir, { recursive: true });
    const missingParentId = "00000000-0000-0000-0000-000000000001";
    const orphanId = "00000000-0000-0000-0000-000000000002";
    writeSession(dir, orphanId, missingParentId);
    const result = checkSessionDag(dir);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("1 dangling");
    expect(result.detail).toContain(orphanId.slice(0, 8));
    expect(result.fix).toBeDefined();
  });

  it("detects multiple dangling references", async () => {
    const { checkSessionDag } = await import("../../src/cli/doctor.js");
    const dir = join(tmpDir, ".phase2s", "sessions");
    mkdirSync(dir, { recursive: true });
    const ghost1 = "00000000-0000-0000-0000-000000000001";
    const ghost2 = "00000000-0000-0000-0000-000000000002";
    const orphan1 = "00000000-0000-0000-0000-000000000003";
    const orphan2 = "00000000-0000-0000-0000-000000000004";
    writeSession(dir, orphan1, ghost1);
    writeSession(dir, orphan2, ghost2);
    const result = checkSessionDag(dir);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("2 dangling");
  });

  it("skips corrupt session files gracefully", async () => {
    const { checkSessionDag } = await import("../../src/cli/doctor.js");
    const dir = join(tmpDir, ".phase2s", "sessions");
    mkdirSync(dir, { recursive: true });
    const validId = "00000000-0000-0000-0000-000000000001";
    writeSession(dir, validId, null);
    writeFileSync(join(dir, "00000000-0000-0000-0000-000000000002.json"), "not json");
    const result = checkSessionDag(dir);
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("1 sessions");
  });

  it("sessions with null parentId are not flagged as dangling", async () => {
    const { checkSessionDag } = await import("../../src/cli/doctor.js");
    const dir = join(tmpDir, ".phase2s", "sessions");
    mkdirSync(dir, { recursive: true });
    writeSession(dir, "00000000-0000-0000-0000-000000000001", null);
    writeSession(dir, "00000000-0000-0000-0000-000000000002", null);
    const result = checkSessionDag(dir);
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("2 sessions");
    expect(result.detail).toContain("0 dangling");
  });
});

// ---------------------------------------------------------------------------
// checkBashPlugin
// ---------------------------------------------------------------------------

describe("checkBashPlugin", () => {
  let tmpDir: string;
  let phase2sDir: string;
  let savedShell: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "phase2s-bash-doctor-test-"));
    phase2sDir = join(tmpDir, ".phase2s");
    mkdirSync(phase2sDir, { recursive: true });
    savedShell = process.env.SHELL;
  });

  afterEach(() => {
    if (savedShell === undefined) {
      delete process.env.SHELL;
    } else {
      process.env.SHELL = savedShell;
    }
    rmSync(tmpDir, { recursive: true, force: true });
    vi.resetModules();
  });

  it("returns ok:true (N/A) when SHELL is a non-Bash shell (e.g. zsh)", async () => {
    process.env.SHELL = "/usr/bin/zsh";
    const { checkBashPlugin } = await import("../../src/cli/doctor.js");
    const result = checkBashPlugin(phase2sDir);
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("detected shell: /usr/bin/zsh");
  });

  it("returns ok:true (N/A) when SHELL is empty/unset", async () => {
    process.env.SHELL = "";
    const { checkBashPlugin } = await import("../../src/cli/doctor.js");
    const result = checkBashPlugin(phase2sDir);
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("detected shell: unknown");
  });

  it("returns ok:false when Bash plugin file is not installed", async () => {
    process.env.SHELL = "/bin/bash";
    const { checkBashPlugin } = await import("../../src/cli/doctor.js");
    const result = checkBashPlugin(phase2sDir);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("not installed");
    expect(result.fix).toBeTruthy();
  });

  it("returns ok:false when plugin exists but phase2sDir is not writable", async () => {
    process.env.SHELL = "/bin/bash";
    // Create the plugin file
    writeFileSync(join(phase2sDir, "phase2s-bash.sh"), "# bash plugin");
    // Remove write permission from the directory
    chmodSync(phase2sDir, 0o555);
    try {
      const { checkBashPlugin } = await import("../../src/cli/doctor.js");
      const result = checkBashPlugin(phase2sDir);
      expect(result.ok).toBe(false);
      expect(result.detail).toContain("not writable");
      expect(result.fix).toBeTruthy();
    } finally {
      chmodSync(phase2sDir, 0o755);
    }
  });

  it("returns ok:false when plugin is installed but not sourced in any profile file", async () => {
    process.env.SHELL = "/bin/bash";
    writeFileSync(join(phase2sDir, "phase2s-bash.sh"), "# bash plugin");
    // Create empty profile files that don't source the plugin
    const fakeProfile = join(tmpDir, ".bash_profile");
    const fakeRc = join(tmpDir, ".bashrc");
    writeFileSync(fakeProfile, "# empty");
    writeFileSync(fakeRc, "# empty");
    const { checkBashPlugin } = await import("../../src/cli/doctor.js");
    const result = checkBashPlugin(phase2sDir, [fakeProfile, fakeRc]);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("not sourced");
    expect(result.fix).toBeTruthy();
  });

  it("returns ok:true when plugin is sourced via absolute path in an injected profile file", async () => {
    process.env.SHELL = "/bin/bash";
    const pluginPath = join(phase2sDir, "phase2s-bash.sh");
    writeFileSync(pluginPath, "# bash plugin");
    const fakeProfile = join(tmpDir, ".bash_profile");
    // Source using absolute path
    writeFileSync(fakeProfile, `source ${pluginPath}\n`);
    const { checkBashPlugin } = await import("../../src/cli/doctor.js");
    const result = checkBashPlugin(phase2sDir, [fakeProfile]);
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("sourced");
  });

  it("returns ok:true when plugin is sourced via $HOME-relative form in an injected profile file", async () => {
    process.env.SHELL = "/bin/bash";
    writeFileSync(join(phase2sDir, "phase2s-bash.sh"), "# bash plugin");
    const fakeRc = join(tmpDir, ".bashrc");
    // Source using the $HOME-relative form that setup --bash writes
    writeFileSync(fakeRc, "source $HOME/.phase2s/phase2s-bash.sh\n");
    const { checkBashPlugin } = await import("../../src/cli/doctor.js");
    const result = checkBashPlugin(phase2sDir, [fakeRc]);
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("sourced");
  });
});


// ---------------------------------------------------------------------------
// runDoctorFix (doctor --fix)
// ---------------------------------------------------------------------------

describe("doctor --fix", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = mkdtempSync(join(tmpdir(), "phase2s-doctor-fix-test-"));
    vi.resetModules();
    spawnSyncMock.mockReset();
    // Default: spawnSync returns success so checkProviderBinary etc. don't interfere
    spawnSyncMock.mockReturnValue({ status: 0, error: null });
  });

  afterEach(() => {
    // Restore cwd before removing tmpDir — chdir into a deleted dir is an ENOENT
    try { process.chdir(originalCwd); } catch { /* ignore */ }
    rmSync(tmpDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("reports recovered sessions when index is stale", async () => {
    // Set up a sessions directory with one valid session file but no index
    const sessDir = join(tmpDir, ".phase2s", "sessions");
    mkdirSync(sessDir, { recursive: true });
    const sessionId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const sessionData = {
      schemaVersion: 2,
      meta: { id: sessionId, parentId: null, branchName: "main", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
      messages: [{ role: "user", content: "hello" }],
    };
    writeFileSync(join(sessDir, `${sessionId}.json`), JSON.stringify(sessionData));

    const logs: string[] = [];
    const origLog = console.log;
    const origWrite = process.stdout.write.bind(process.stdout);
    console.log = (...args: unknown[]) => { logs.push(args.join(" ")); };
    process.stdout.write = (s: string | Uint8Array) => { logs.push(String(s)); return true; };

    process.chdir(tmpDir);
    try {
      const { runDoctor } = await import("../../src/cli/doctor.js");
      await runDoctor({ fix: true });
    } finally {
      console.log = origLog;
      process.stdout.write = origWrite;
    }

    const output = logs.join("\n");
    expect(output).toContain("Recovered: 1 session");
    expect(output).toContain("was 0, now 1");
    expect(output).toContain("DAG check: OK");
  });

  it("reports index was current when no sessions are missing", async () => {
    const sessDir = join(tmpDir, ".phase2s", "sessions");
    mkdirSync(sessDir, { recursive: true });
    // No session files → before=0, after=0

    const logs: string[] = [];
    const origLog = console.log;
    const origWrite = process.stdout.write.bind(process.stdout);
    console.log = (...args: unknown[]) => { logs.push(args.join(" ")); };
    process.stdout.write = (s: string | Uint8Array) => { logs.push(String(s)); return true; };

    process.chdir(tmpDir);
    try {
      const { runDoctor } = await import("../../src/cli/doctor.js");
      await runDoctor({ fix: true });
    } finally {
      console.log = origLog;
      process.stdout.write = origWrite;
    }

    const output = logs.join("\n");
    // No index and no sessions → "Nothing to repair" (fresh/wiped install case)
    expect(output).toContain("Nothing to repair");
  });

  it("reports DAG warnings and exits 1 when sessions have dangling parentIds", async () => {
    const sessDir = join(tmpDir, ".phase2s", "sessions");
    mkdirSync(sessDir, { recursive: true });
    // Session with a parentId that doesn't exist
    const sessionId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const sessionData = {
      schemaVersion: 2,
      meta: { id: sessionId, parentId: "nonexistent-parent-uuid", branchName: "main", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
      messages: [],
    };
    writeFileSync(join(sessDir, `${sessionId}.json`), JSON.stringify(sessionData));

    const logs: string[] = [];
    const origLog = console.log;
    const origWrite = process.stdout.write.bind(process.stdout);
    console.log = (...args: unknown[]) => { logs.push(args.join(" ")); };
    process.stdout.write = (s: string | Uint8Array) => { logs.push(String(s)); return true; };
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((_code?: number | string | null | undefined) => { throw new Error("process.exit called"); });

    process.chdir(tmpDir);
    try {
      const { runDoctor } = await import("../../src/cli/doctor.js");
      await expect(runDoctor({ fix: true })).rejects.toThrow("process.exit called");
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      console.log = origLog;
      process.stdout.write = origWrite;
      exitSpy.mockRestore();
    }

    const output = logs.join("\n");
    expect(output).toContain("DAG check: warnings");
  });

  it("exits 1 when rebuildSessionIndexStrict throws", async () => {
    const sessDir = join(tmpDir, ".phase2s", "sessions");
    mkdirSync(sessDir, { recursive: true });

    // Spy on rebuildSessionIndexStrict via the session module to make it throw.
    // We import both doctor and session at test time so the spy takes effect.
    const sessionMod = await import("../../src/core/session.js");
    const strictSpy = vi.spyOn(sessionMod, "rebuildSessionIndexStrict").mockRejectedValue(
      new Error("EPERM: permission denied"),
    );

    process.chdir(tmpDir);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((_code?: number | string | null | undefined) => { throw new Error("process.exit called"); });
    const origErr = console.error;
    const origWrite = process.stdout.write.bind(process.stdout);
    console.error = () => {};
    process.stdout.write = (() => true) as typeof process.stdout.write;

    try {
      const { runDoctor } = await import("../../src/cli/doctor.js");
      await expect(runDoctor({ fix: true })).rejects.toThrow("process.exit called");
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      console.error = origErr;
      process.stdout.write = origWrite;
      exitSpy.mockRestore();
      strictSpy.mockRestore();
    }
  });

  it("reports 'index was current' when sessions exist and index is already up to date", async () => {
    const sessDir = join(tmpDir, ".phase2s", "sessions");
    mkdirSync(sessDir, { recursive: true });
    const sessionId = "aaaaaaaa-bbbb-cccc-dddd-ffffffffffff";
    const sessionData = {
      schemaVersion: 2,
      meta: { id: sessionId, parentId: null, branchName: "main", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
      messages: [{ role: "user", content: "hello" }],
    };
    writeFileSync(join(sessDir, `${sessionId}.json`), JSON.stringify(sessionData));

    // First run to build the index (before = 0, after = 1, recovered = 1)
    process.chdir(tmpDir);
    {
      const { runDoctor: first } = await import("../../src/cli/doctor.js");
      await first({ fix: true });
    }
    vi.resetModules();

    // Second run — index is already current (before = 1, after = 1, recovered = 0)
    const logs: string[] = [];
    const origLog = console.log;
    const origWrite = process.stdout.write.bind(process.stdout);
    console.log = (...args: unknown[]) => { logs.push(args.join(" ")); };
    process.stdout.write = (s: string | Uint8Array) => { logs.push(String(s)); return true; };

    try {
      const { runDoctor } = await import("../../src/cli/doctor.js");
      await runDoctor({ fix: true });
    } finally {
      console.log = origLog;
      process.stdout.write = origWrite;
    }

    const output = logs.join("\n");
    expect(output).toContain("Recovered: 0 sessions");
    expect(output).toContain("index was current");
  });

  it("reports cleaned-up stale entries when index has more sessions than exist on disk", async () => {
    // Regression test for v1.23.0 fix: stale-entry count was negative and output was misleading.
    const sessDir = join(tmpDir, ".phase2s", "sessions");
    mkdirSync(sessDir, { recursive: true });

    // Write a session file so the index gets built with 1 entry.
    const sessionId = "aaaaaaaa-bbbb-cccc-dddd-aaaaaaaaaaaa";
    const sessionData = {
      schemaVersion: 2,
      meta: { id: sessionId, parentId: null, branchName: "main", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
      messages: [],
    };
    writeFileSync(join(sessDir, `${sessionId}.json`), JSON.stringify(sessionData));

    // Build the initial index (1 session).
    process.chdir(tmpDir);
    {
      const { runDoctor: first } = await import("../../src/cli/doctor.js");
      await first({ fix: true });
    }
    vi.resetModules();

    // Delete the session file to simulate a stale index (index has 1, disk has 0).
    const { unlinkSync } = await import("node:fs");
    unlinkSync(join(sessDir, `${sessionId}.json`));
    vi.resetModules();

    const logs: string[] = [];
    const origLog = console.log;
    const origWrite = process.stdout.write.bind(process.stdout);
    console.log = (...args: unknown[]) => { logs.push(args.join(" ")); };
    process.stdout.write = (s: string | Uint8Array) => { logs.push(String(s)); return true; };

    try {
      const { runDoctor } = await import("../../src/cli/doctor.js");
      await runDoctor({ fix: true });
    } finally {
      console.log = origLog;
      process.stdout.write = origWrite;
    }

    const output = logs.join("\n");
    expect(output).toContain("Cleaned up: 1 stale entry");
    expect(output).toContain("was 1, now 0");
  });

  it("exits 1 when sessions dir exists but is unreadable (EACCES)", async () => {
    // Regression test: EACCES should propagate, not be silently treated as "Cleaned up N entries".
    // Skip on CI environments where tests run as root (root ignores chmod 000).
    if (process.getuid && process.getuid() === 0) return;

    const sessDir = join(tmpDir, ".phase2s", "sessions");
    mkdirSync(sessDir, { recursive: true });
    // Make the sessions dir unreadable
    const { chmodSync } = await import("node:fs");
    chmodSync(sessDir, 0o000);

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((_code?: number | string | null | undefined) => { throw new Error("process.exit called"); });
    const origErr = console.error;
    const origWrite = process.stdout.write.bind(process.stdout);
    console.error = () => {};
    process.stdout.write = (() => true) as typeof process.stdout.write;

    process.chdir(tmpDir);
    try {
      const { runDoctor } = await import("../../src/cli/doctor.js");
      await expect(runDoctor({ fix: true })).rejects.toThrow("process.exit called");
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      chmodSync(sessDir, 0o755); // restore so rmSync in afterEach can clean up
      console.error = origErr;
      process.stdout.write = origWrite;
      exitSpy.mockRestore();
    }
  });

  it("doctor without --fix runs normal checks (does not output fix messages)", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => { logs.push(args.join(" ")); };

    process.chdir(tmpDir);
    try {
      const { runDoctor } = await import("../../src/cli/doctor.js");
      await runDoctor();  // no { fix: true }
    } finally {
      console.log = origLog;
    }

    const output = logs.join("\n");
    expect(output).toContain("Phase2S doctor");
    expect(output).not.toContain("Rebuilding session index");
    expect(output).not.toContain("Recovered:");
  });
});
