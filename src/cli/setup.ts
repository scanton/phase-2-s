/**
 * phase2s setup — install shell integration (ZSH plugin).
 *
 * Copies the bundled .zsh plugin to ~/.phase2s/phase2s.plugin.zsh and
 * appends a `source` line to ~/.zshrc (idempotent).
 *
 * Usage:
 *   phase2s setup            — install / upgrade the ZSH plugin
 *   phase2s setup --dry-run  — show what would be done without writing anything
 */

import { existsSync, mkdirSync, copyFileSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import chalk from "chalk";
import { bundledShellPluginPath } from "../skills/loader.js";

// ---------------------------------------------------------------------------
// runSetup
// ---------------------------------------------------------------------------

export interface SetupOptions {
  dryRun?: boolean;
  /** Override install directory (default: ~/.phase2s). Used in tests. */
  phase2sDir?: string;
  /** Override .zshrc path (default: ~/.zshrc). Used in tests. */
  zshrcPath?: string;
}

export async function runSetup(options: SetupOptions = {}): Promise<void> {
  const {
    dryRun = false,
    phase2sDir = join(homedir(), ".phase2s"),
    zshrcPath = join(homedir(), ".zshrc"),
  } = options;

  // Detect shell — warn if not ZSH (ZSH is the only supported shell in v1.20.0)
  const shell = process.env.SHELL ?? "";
  if (shell && !shell.includes("zsh")) {
    console.warn(chalk.yellow(`\n  Detected shell: ${shell}`));
    console.warn(chalk.yellow("  This plugin requires ZSH. Install ZSH, or use 'p2' as a manual alias once ZSH is set up."));
    console.warn(chalk.yellow("  Bash support is coming in a future release.\n"));
  }

  const pluginSrc = bundledShellPluginPath();
  const pluginDest = join(phase2sDir, "phase2s.plugin.zsh");
  const sourceLine = `source "${pluginDest}" # phase2s shell integration\n`;

  if (dryRun) {
    console.log(chalk.bold("\n  phase2s setup --dry-run\n"));
    console.log(`  Would copy:   ${pluginSrc}`);
    console.log(`         → ${pluginDest}`);
    console.log(`  Would append: source "${pluginDest}" # phase2s shell integration`);
    console.log(`         → ${zshrcPath}`);
    console.log(`  (no files written)\n`);
    return;
  }

  // 1. Create ~/.phase2s/ and copy plugin file
  try {
    mkdirSync(phase2sDir, { recursive: true });
    copyFileSync(pluginSrc, pluginDest);
    console.log(chalk.green(`\n  ✓ Plugin installed: ${pluginDest}`));
  } catch (err) {
    console.error(chalk.red(`\n  Cannot write plugin to ${pluginDest}: ${(err as NodeJS.ErrnoException).message}`));
    console.error(chalk.red("  Check directory permissions.\n"));
    process.exit(1);
    return; // safety guard when process.exit is mocked in tests
  }

  // 2. Append source line to ~/.zshrc (idempotent: check for exact pluginDest path)
  const existing = existsSync(zshrcPath) ? readFileSync(zshrcPath, "utf8") : "";
  if (!existing.includes(pluginDest)) {
    // Trailing newline guard: prepend \n if the file doesn't end with one
    const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
    try {
      appendFileSync(zshrcPath, `${prefix}${sourceLine}`);
      console.log(chalk.green(`  ✓ Added to ${zshrcPath}`));
    } catch (err) {
      console.error(chalk.red(`\n  Cannot write to ${zshrcPath}: ${(err as NodeJS.ErrnoException).message}`));
      console.error(chalk.red("  Check file permissions.\n"));
      process.exit(1);
      return;
    }
  } else {
    console.log(chalk.dim(`  Already in ${zshrcPath} — skipped.`));
  }

  // 3. Print confirmation
  console.log(`
  Restart your shell, or run:
    ${chalk.bold("source ~/.zshrc")}

  Then try:
    ${chalk.bold(": what does this codebase do?")}
    ${chalk.bold(": fix the null check in auth.ts")}
    ${chalk.bold("p2 suggest \"find large log files\"")}
`);
}
