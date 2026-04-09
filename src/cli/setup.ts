/**
 * phase2s setup — install shell integration (ZSH or Bash plugin).
 *
 * ZSH (default):
 *   Copies the bundled .zsh plugin to ~/.phase2s/phase2s.plugin.zsh and
 *   appends a `source` line to ~/.zshrc (idempotent).
 *
 * Bash (--bash flag):
 *   Copies the bundled bash script to ~/.phase2s/phase2s-bash.sh and
 *   appends a `source` line to ~/.bash_profile (idempotent).
 *   Note: ~/.bash_profile is sourced only in login shells. VS Code terminals
 *   and other non-login bash instances use ~/.bashrc. Users should source
 *   the script from ~/.bashrc as well if they use non-login bash.
 *
 * Usage:
 *   phase2s setup            — install / upgrade the ZSH plugin
 *   phase2s setup --bash     — install / upgrade the Bash plugin
 *   phase2s setup --dry-run  — show what would be done without writing anything
 */

import { existsSync, mkdirSync, copyFileSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import chalk from "chalk";
import { bundledShellPluginPath, bundledBashPluginPath } from "../skills/loader.js";

// ---------------------------------------------------------------------------
// runSetup
// ---------------------------------------------------------------------------

export interface SetupOptions {
  dryRun?: boolean;
  /** Install the Bash plugin instead of ZSH. */
  bash?: boolean;
  /** Override install directory (default: ~/.phase2s). Used in tests. */
  phase2sDir?: string;
  /** Override .zshrc path (default: ~/.zshrc). Used in tests. */
  zshrcPath?: string;
  /** Override .bash_profile path (default: ~/.bash_profile). Used in tests. */
  profilePath?: string;
}

export async function runSetup(options: SetupOptions = {}): Promise<void> {
  const {
    dryRun = false,
    bash = false,
    phase2sDir = join(homedir(), ".phase2s"),
    zshrcPath = join(homedir(), ".zshrc"),
    profilePath = join(homedir(), ".bash_profile"),
  } = options;

  if (bash) {
    return runBashSetup({ dryRun, phase2sDir, profilePath });
  }

  // Detect shell — warn if not ZSH, but only when the user didn't request bash explicitly.
  // This prevents the warning from firing for bash users who've already passed --bash.
  const shell = process.env.SHELL ?? "";
  if (shell && !shell.includes("zsh")) {
    console.warn(chalk.yellow(`\n  Detected shell: ${shell}`));
    console.warn(chalk.yellow("  This plugin requires ZSH. Run `phase2s setup --bash` for Bash support."));
    console.warn(chalk.yellow("  Or install ZSH and re-run setup.\n"));
  }

  const pluginSrc = bundledShellPluginPath();
  const pluginDest = join(phase2sDir, "phase2s.plugin.zsh");
  // Use $HOME-relative path in the source line so .zshrc is portable across
  // home directory renames and machine migrations. The literal string "$HOME"
  // is what ZSH expands at shell startup — not the absolute path.
  const homeRelativePluginPath = "$HOME/.phase2s/phase2s.plugin.zsh";
  const sourceLine = `source "${homeRelativePluginPath}" # phase2s shell integration\n`;

  if (dryRun) {
    console.log(chalk.bold("\n  phase2s setup --dry-run\n"));
    console.log(`  Would copy:   ${pluginSrc}`);
    console.log(`         → ${pluginDest}`);
    console.log(`  Would append: source "${homeRelativePluginPath}" # phase2s shell integration`);
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

  // 2. Append source line to ~/.zshrc (idempotent: check for $HOME-relative path OR
  //    legacy absolute path from versions < 1.20.0 that used an absolute path)
  let existing = "";
  try {
    existing = existsSync(zshrcPath) ? readFileSync(zshrcPath, "utf8") : "";
  } catch (err) {
    console.error(chalk.red(`\n  Cannot read ${zshrcPath}: ${(err as NodeJS.ErrnoException).message}`));
    console.error(chalk.red("  Check file permissions.\n"));
    process.exit(1);
    return;
  }
  const alreadySourced = existing.includes(homeRelativePluginPath) || existing.includes(pluginDest);
  if (!alreadySourced) {
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
  To activate in your current shell, run:
    ${chalk.bold("source ~/.phase2s/phase2s.plugin.zsh")}

  Or open a new terminal tab — the plugin loads automatically.

  Then try:
    ${chalk.bold(": what does this codebase do?")}
    ${chalk.bold(": fix the null check in auth.ts")}
    ${chalk.bold("p2 suggest \"find large log files\"")}
`);
}

// ---------------------------------------------------------------------------
// Bash setup
// ---------------------------------------------------------------------------

interface BashSetupOptions {
  dryRun: boolean;
  phase2sDir: string;
  profilePath: string;
}

async function runBashSetup({ dryRun, phase2sDir, profilePath }: BashSetupOptions): Promise<void> {
  const pluginSrc = bundledBashPluginPath();
  const pluginDest = join(phase2sDir, "phase2s-bash.sh");
  // Use $HOME-relative path for portability in .bash_profile
  const homeRelativePluginPath = "$HOME/.phase2s/phase2s-bash.sh";
  // Sentinel string: used for both idempotency check and append.
  // Must be unique enough to not appear in an unrelated source line.
  const sentinel = "# phase2s bash integration";
  const sourceLine = `source "${homeRelativePluginPath}" ${sentinel}\n`;

  if (dryRun) {
    console.log(chalk.bold("\n  phase2s setup --bash --dry-run\n"));
    console.log(`  Would copy:   ${pluginSrc}`);
    console.log(`         → ${pluginDest}`);
    console.log(`  Would append: source "${homeRelativePluginPath}" ${sentinel}`);
    console.log(`         → ${profilePath}`);
    console.log(`  (no files written)\n`);
    console.log(chalk.dim("  Note: ~/.bash_profile is sourced in login shells only."));
    console.log(chalk.dim("  For VS Code and non-login terminals, also add the source line to ~/.bashrc.\n"));
    return;
  }

  // 1. Create ~/.phase2s/ and copy bash script
  try {
    mkdirSync(phase2sDir, { recursive: true });
    copyFileSync(pluginSrc, pluginDest);
    console.log(chalk.green(`\n  ✓ Bash plugin installed: ${pluginDest}`));
  } catch (err) {
    console.error(chalk.red(`\n  Cannot write plugin to ${pluginDest}: ${(err as NodeJS.ErrnoException).message}`));
    console.error(chalk.red("  Check directory permissions.\n"));
    process.exit(1);
    return;
  }

  // 2. Append source line to ~/.bash_profile (idempotent via sentinel comment)
  let existing = "";
  try {
    existing = existsSync(profilePath) ? readFileSync(profilePath, "utf8") : "";
  } catch (err) {
    console.error(chalk.red(`\n  Cannot read ${profilePath}: ${(err as NodeJS.ErrnoException).message}`));
    console.error(chalk.red("  Check file permissions.\n"));
    process.exit(1);
    return;
  }
  if (!existing.includes(sentinel)) {
    const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
    try {
      appendFileSync(profilePath, `${prefix}${sourceLine}`);
      console.log(chalk.green(`  ✓ Added to ${profilePath}`));
    } catch (err) {
      console.error(chalk.red(`\n  Cannot write to ${profilePath}: ${(err as NodeJS.ErrnoException).message}`));
      console.error(chalk.red("  Check file permissions.\n"));
      process.exit(1);
      return;
    }
  } else {
    console.log(chalk.dim(`  Already in ${profilePath} — skipped.`));
  }

  // 3. Print confirmation
  console.log(`
  To activate in your current shell, run:
    ${chalk.bold("source ~/.phase2s/phase2s-bash.sh")}

  Or open a new terminal tab — the plugin loads automatically in login shells.

  ${chalk.dim("Note: ~/.bash_profile is sourced only in login shells.")}
  ${chalk.dim("For VS Code and non-login terminals, also add this line to ~/.bashrc:")}
    ${chalk.dim(`source "$HOME/.phase2s/phase2s-bash.sh" ${sentinel}`)}

  Then try:
    ${chalk.bold(": what does this codebase do?")}
    ${chalk.bold(": fix the null check in auth.ts")}
`);
}
