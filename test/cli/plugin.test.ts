import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Plugin file content tests
//
// These tests verify that the bundled ZSH plugin file exists at the expected
// location and contains the required ZSH function definitions.
// ---------------------------------------------------------------------------

const pluginPath = join(process.cwd(), ".phase2s", "shell", "phase2s.plugin.zsh");

describe("phase2s.plugin.zsh", () => {
  it("exists at .phase2s/shell/phase2s.plugin.zsh", () => {
    expect(existsSync(pluginPath)).toBe(true);
  });

  it("defines __phase2s_run and aliases ':' with noglob to suppress glob expansion", () => {
    const content = readFileSync(pluginPath, "utf8");
    // The helper function handles the actual routing
    expect(content).toContain("function __phase2s_run()");
    // The alias must use noglob so 'do?' and similar patterns aren't glob-expanded
    // before the function receives them (ZSH expands globs before function lookup)
    expect(content).toContain("alias ':=noglob __phase2s_run'");
  });

  it("contains the p2 alias with noglob", () => {
    const content = readFileSync(pluginPath, "utf8");
    expect(content).toContain("alias p2='noglob __phase2s_run'");
  });

  it("contains the inline _phase2s() completion function", () => {
    const content = readFileSync(pluginPath, "utf8");
    expect(content).toContain("function _phase2s()");
    expect(content).toContain("compdef _phase2s phase2s");
  });

  it("does not contain Windows CRLF line endings", () => {
    const content = readFileSync(pluginPath, "utf8");
    expect(content).not.toContain("\r\n");
  });

  it("guards : to pass through when called with no args or a comment", () => {
    const content = readFileSync(pluginPath, "utf8");
    // The guard must handle $# -eq 0 and '#' prefix to avoid passing comments to phase2s
    expect(content).toContain('$#');
    expect(content).toContain('"#"');
  });

  it("passes ZSH syntax check (skipped if zsh not in PATH)", () => {
    const which = spawnSync("which", ["zsh"], { encoding: "utf8" });
    if (!which || which.status !== 0) {
      // zsh not available in this environment — skip
      return;
    }
    const result = spawnSync("zsh", ["--no-rcs", "-n", pluginPath], {
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stderr ?? "").toBe("");
  });
});
