import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runSetup } from "../../src/cli/setup.js";

// bundledShellPluginPath() uses import.meta.url which resolves to src/skills/loader.ts
// in the vitest environment (source path, not dist path). Three levels up overshoots
// the project root. Mock to return the correct source path.
vi.mock("../../src/skills/loader.js", () => ({
  bundledShellPluginPath: () => join(process.cwd(), ".phase2s", "shell", "phase2s.plugin.zsh"),
  bundledTemplatesDir: () => join(process.cwd(), ".phase2s", "templates"),
  bundledBashPluginPath: () => join(process.cwd(), ".phase2s", "shell", "phase2s-bash.sh"),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  const dir = join(tmpdir(), `phase2s-setup-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runSetup()", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = makeTmpDir();
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it("copies plugin file to phase2sDir", async () => {
    const phase2sDir = join(tmpHome, ".phase2s");
    const zshrcPath = join(tmpHome, ".zshrc");
    writeFileSync(zshrcPath, "# existing content\n");

    await runSetup({ phase2sDir, zshrcPath });

    const pluginDest = join(phase2sDir, "phase2s.plugin.zsh");
    expect(existsSync(pluginDest)).toBe(true);
    const content = readFileSync(pluginDest, "utf8");
    expect(content).toContain("function : ()");
  });

  it("appends source line to zshrc when not present", async () => {
    const phase2sDir = join(tmpHome, ".phase2s");
    const zshrcPath = join(tmpHome, ".zshrc");
    writeFileSync(zshrcPath, "# existing content\n");

    await runSetup({ phase2sDir, zshrcPath });

    const content = readFileSync(zshrcPath, "utf8");
    // Source line uses $HOME-relative path for portability (not the absolute pluginDest)
    expect(content).toContain('source "$HOME/.phase2s/phase2s.plugin.zsh"');
    expect(content).toContain("# phase2s shell integration");
  });

  it("is idempotent — does not duplicate source line on second run", async () => {
    const phase2sDir = join(tmpHome, ".phase2s");
    const zshrcPath = join(tmpHome, ".zshrc");
    writeFileSync(zshrcPath, "# existing content\n");

    await runSetup({ phase2sDir, zshrcPath });
    await runSetup({ phase2sDir, zshrcPath });

    const content = readFileSync(zshrcPath, "utf8");
    const occurrences = content.split('source "$HOME/.phase2s/phase2s.plugin.zsh"').length - 1;
    expect(occurrences).toBe(1);
  });

  it("prepends \\n before source line when zshrc does not end with newline", async () => {
    const phase2sDir = join(tmpHome, ".phase2s");
    const zshrcPath = join(tmpHome, ".zshrc");
    // No trailing newline
    writeFileSync(zshrcPath, "export PATH=$HOME/.bin:$PATH");

    await runSetup({ phase2sDir, zshrcPath });

    const content = readFileSync(zshrcPath, "utf8");
    // Source line must be on its own line — check that it doesn't concatenate to PATH line
    // (export PATH is the first line so no \n precedes it — just verify it's intact)
    expect(content).toContain("export PATH=$HOME/.bin:$PATH");
    expect(content).toMatch(/\nsource "/);
    // Ensure the source line is properly terminated
    const lines = content.split("\n");
    const sourceLine = lines.find((l) => l.startsWith('source "'));
    expect(sourceLine).toBeTruthy();
  });

  it("creates zshrc file when it does not exist", async () => {
    const phase2sDir = join(tmpHome, ".phase2s");
    const zshrcPath = join(tmpHome, ".zshrc");
    // Intentionally do NOT create zshrc

    await runSetup({ phase2sDir, zshrcPath });

    expect(existsSync(zshrcPath)).toBe(true);
    const content = readFileSync(zshrcPath, "utf8");
    expect(content).toContain('source "$HOME/.phase2s/phase2s.plugin.zsh"');
  });

  it("creates phase2sDir when it does not exist", async () => {
    const phase2sDir = join(tmpHome, ".phase2s-new");
    const zshrcPath = join(tmpHome, ".zshrc");
    writeFileSync(zshrcPath, "\n");

    await runSetup({ phase2sDir, zshrcPath });

    expect(existsSync(phase2sDir)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Shell detection
  // -------------------------------------------------------------------------

  it("prints no warning when SHELL contains zsh", async () => {
    const phase2sDir = join(tmpHome, ".phase2s");
    const zshrcPath = join(tmpHome, ".zshrc");
    writeFileSync(zshrcPath, "\n");
    vi.stubEnv("SHELL", "/bin/zsh");

    await runSetup({ phase2sDir, zshrcPath });

    expect(warnSpy).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("prints warning when SHELL does not contain zsh", async () => {
    const phase2sDir = join(tmpHome, ".phase2s");
    const zshrcPath = join(tmpHome, ".zshrc");
    writeFileSync(zshrcPath, "\n");
    vi.stubEnv("SHELL", "/bin/bash");

    await runSetup({ phase2sDir, zshrcPath });

    expect(warnSpy).toHaveBeenCalled();
    const warnCalls = warnSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(warnCalls).toContain("/bin/bash");
    vi.unstubAllEnvs();
  });

  // -------------------------------------------------------------------------
  // --dry-run
  // -------------------------------------------------------------------------

  it("--dry-run prints plan without writing files", async () => {
    const phase2sDir = join(tmpHome, ".phase2s");
    const zshrcPath = join(tmpHome, ".zshrc");
    // No files exist

    await runSetup({ dryRun: true, phase2sDir, zshrcPath });

    // Nothing should be written
    expect(existsSync(phase2sDir)).toBe(false);
    expect(existsSync(zshrcPath)).toBe(false);
    // Should print what would be done
    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("dry-run");
    expect(output).toContain("Would copy");
  });

  // -------------------------------------------------------------------------
  // Confirmation output
  // -------------------------------------------------------------------------

  it("prints confirmation with example commands after successful setup", async () => {
    const phase2sDir = join(tmpHome, ".phase2s");
    const zshrcPath = join(tmpHome, ".zshrc");
    writeFileSync(zshrcPath, "\n");

    await runSetup({ phase2sDir, zshrcPath });

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("source ~/.phase2s/phase2s.plugin.zsh");
    expect(output).toContain(": what does this codebase do?");
    expect(output).toContain(": fix the null check in auth.ts");
  });

  it("prints 'Already in' message on second run", async () => {
    const phase2sDir = join(tmpHome, ".phase2s");
    const zshrcPath = join(tmpHome, ".zshrc");
    writeFileSync(zshrcPath, "\n");

    await runSetup({ phase2sDir, zshrcPath });

    // Reset spy to check second run output specifically
    vi.spyOn(console, "log").mockImplementation(() => {});
    const consoleSpy2 = vi.spyOn(console, "log");
    await runSetup({ phase2sDir, zshrcPath });

    const output2 = consoleSpy2.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output2).toContain("Already in");
  });
});

// ---------------------------------------------------------------------------
// Bash setup (--bash flag)
// ---------------------------------------------------------------------------

describe("runSetup() --bash", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = join(tmpdir(), `phase2s-bash-setup-test-${Date.now()}`);
    mkdirSync(tmpHome, { recursive: true });
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("copies the bash plugin to phase2sDir", async () => {
    const phase2sDir = join(tmpHome, ".phase2s");
    const profilePath = join(tmpHome, ".bash_profile");
    await runSetup({ bash: true, phase2sDir, profilePath });
    expect(existsSync(join(phase2sDir, "phase2s-bash.sh"))).toBe(true);
  });

  it("appends a source line to ~/.bash_profile", async () => {
    const phase2sDir = join(tmpHome, ".phase2s");
    const profilePath = join(tmpHome, ".bash_profile");
    writeFileSync(profilePath, "# existing content\n");
    await runSetup({ bash: true, phase2sDir, profilePath });
    const content = readFileSync(profilePath, "utf8");
    expect(content).toContain("phase2s-bash.sh");
    expect(content).toContain("# phase2s bash integration");
  });

  it("is idempotent: second run does not duplicate the source line", async () => {
    const phase2sDir = join(tmpHome, ".phase2s");
    const profilePath = join(tmpHome, ".bash_profile");
    writeFileSync(profilePath, "");
    await runSetup({ bash: true, phase2sDir, profilePath });
    await runSetup({ bash: true, phase2sDir, profilePath });
    const content = readFileSync(profilePath, "utf8");
    const count = (content.match(/# phase2s bash integration/g) ?? []).length;
    expect(count).toBe(1);
  });

  it("--bash --dry-run prints plan without writing files", async () => {
    const phase2sDir = join(tmpHome, ".phase2s");
    const profilePath = join(tmpHome, ".bash_profile");
    await runSetup({ bash: true, dryRun: true, phase2sDir, profilePath });
    expect(existsSync(phase2sDir)).toBe(false);
    expect(existsSync(profilePath)).toBe(false);
    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("dry-run");
    expect(output).toContain("Would copy");
  });

  it("does not emit ZSH warning when --bash is passed", async () => {
    const warnMessages: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((...args) => warnMessages.push(String(args[0])));
    const originalShell = process.env.SHELL;
    process.env.SHELL = "/bin/bash";
    try {
      const phase2sDir = join(tmpHome, ".phase2s");
      const profilePath = join(tmpHome, ".bash_profile");
      await runSetup({ bash: true, phase2sDir, profilePath });
      // No ZSH warning should appear for bash users who used --bash
      expect(warnMessages.some((m) => /requires ZSH/i.test(m))).toBe(false);
    } finally {
      process.env.SHELL = originalShell;
    }
  });

  it("prints confirmation with source and login shell note", async () => {
    const phase2sDir = join(tmpHome, ".phase2s");
    const profilePath = join(tmpHome, ".bash_profile");
    writeFileSync(profilePath, "");
    await runSetup({ bash: true, phase2sDir, profilePath });
    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("source ~/.phase2s/phase2s-bash.sh");
    expect(output).toContain(": what does this codebase do?");
  });

  it("prints 'Already in' on second run", async () => {
    const phase2sDir = join(tmpHome, ".phase2s");
    const profilePath = join(tmpHome, ".bash_profile");
    writeFileSync(profilePath, "");
    await runSetup({ bash: true, phase2sDir, profilePath });
    vi.spyOn(console, "log").mockImplementation(() => {});
    const consoleSpy2 = vi.spyOn(console, "log");
    await runSetup({ bash: true, phase2sDir, profilePath });
    const output2 = consoleSpy2.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output2).toContain("Already in");
  });
});
