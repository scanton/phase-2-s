/**
 * phase2s commit — AI-generated commit messages.
 *
 * Flow:
 *   1. Verify we are inside a git repo.
 *   2. Check for staged changes. If nothing is staged (and HEAD exists), exit.
 *      On an unborn HEAD (initial commit), git diff --cached works without HEAD.
 *   3. Read the staged diff.
 *   4. Enforce a 4000-line cap to avoid sending enormous diffs to the model.
 *   5. Scan for common secret patterns and warn before sending.
 *   6. Ask the fast_model tier to write a conventional commit message.
 *   7. Interactive: [a]ccept / [e]dit / [c]ancel — or --auto / --preview modes.
 *   8. Run `git commit -m "message"` via spawnSync (no shell, clean hook output).
 *
 * Exported functions:
 *   buildCommitMessage(config)   — steps 1-6, returns CommitMessageResult | null
 *   runCommitFlow(config, opts)  — full flow including interactive prompt and commit
 *
 * The :commit REPL command calls buildCommitMessage() directly so the agent conversation
 * is never touched.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import chalk from "chalk";
import { Agent } from "../core/agent.js";
import { scanForSecrets } from "../core/secrets.js";
import { createRl, ask } from "./prompt-util.js";
import type { Config } from "../core/config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CommitMessageResult {
  /** The proposed commit message (single line, max 72 chars per prompt instructions). */
  message: string;
  /** Output of `git diff --cached --stat` — shown in --preview and error fallback. */
  diffStat: string;
}

export interface CommitFlowOptions {
  /** Commit immediately without interactive confirmation. CI-safe. */
  auto?: boolean;
  /** Print proposed message and exit without committing. */
  preview?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of diff lines to send to the model. */
const MAX_DIFF_LINES = 4000;

/** Conventional commit prompt sent to the fast model. */
const COMMIT_PROMPT = (diff: string, format: string) =>
  format === "conventional"
    ? `Write a git commit message for the following diff. Use the Conventional Commits format:
<type>(<scope>): <subject>

Types: feat, fix, docs, style, refactor, test, chore, perf, ci, build
- One line only. No body. No period at the end.
- Max 72 characters total.
- scope is optional — omit if not obvious from the diff.
- subject is lowercase and imperative ("add" not "added" or "adds").

Respond with ONLY the commit message. No explanation, no markdown, no quotes.

DIFF:
${diff}`
    : `Write a short, clear git commit message (one line, max 72 chars) for this diff.
Respond with ONLY the message. No explanation, no markdown, no quotes.

DIFF:
${diff}`;

// ---------------------------------------------------------------------------
// Git helpers (all use spawnSync — no shell, clean stdout/stderr capture)
// ---------------------------------------------------------------------------

/** Returns true if the current directory is inside a git repository. */
function isGitRepo(): boolean {
  const result = spawnSync("git", ["rev-parse", "--git-dir"], {
    encoding: "utf8",
    stdio: "pipe",
  });
  return result.status === 0;
}

/** Returns true if HEAD points to an existing commit (false on initial repo). */
function headExists(): boolean {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
    stdio: "pipe",
  });
  return result.status === 0;
}

/** Returns the output of `git diff --cached --stat`, or empty string if nothing staged. */
function getStagedStat(): string {
  const result = spawnSync("git", ["diff", "--cached", "--stat"], {
    encoding: "utf8",
    stdio: "pipe",
  });
  return result.status === 0 ? result.stdout.trim() : "";
}

/** Returns the raw `git diff --cached` output. */
function getStagedDiff(): string {
  const result = spawnSync("git", ["diff", "--cached"], {
    encoding: "utf8",
    stdio: "pipe",
  });
  return result.status === 0 ? result.stdout : "";
}

/** Run git commit with the given message. Returns { ok, output }. */
function runGitCommit(message: string): { ok: boolean; output: string } {
  const result = spawnSync("git", ["commit", "-m", message], {
    encoding: "utf8",
    stdio: "pipe",
  });
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  return { ok: result.status === 0, output };
}

// ---------------------------------------------------------------------------
// Core: build the commit message (steps 1-6)
// ---------------------------------------------------------------------------

/**
 * Build a commit message for the currently staged diff.
 *
 * @returns CommitMessageResult if a message was generated, or null if the model
 *   returned an empty/unparseable response.
 * @throws Error with a user-visible message for precondition failures (not a git
 *   repo, nothing staged, diff too large, user cancelled secret warning).
 */
export async function buildCommitMessage(
  config: Config,
  opts: { secretsSendAnyway?: boolean } = {},
): Promise<CommitMessageResult | null> {
  // Step 1: verify git repo
  if (!isGitRepo()) {
    throw new Error("Not a git repository.");
  }

  // Step 2: check staged changes
  const diffStat = getStagedStat();
  const hasStagedChanges = diffStat.length > 0;

  if (!hasStagedChanges) {
    if (!headExists()) {
      // Initial repo, unborn HEAD: git diff --cached works even without HEAD.
      // getStagedStat() returns empty on unborn HEAD even with staged files
      // because --stat formatting requires HEAD context. Fall through to reading
      // the raw diff directly — if nothing is staged there either, the diff will
      // be empty and we exit below.
    } else {
      throw new Error("Nothing staged. Run `git add <files>` first.");
    }
  }

  // Step 3: read the diff
  const diff = getStagedDiff();
  if (!diff.trim()) {
    if (!headExists()) {
      // On unborn HEAD with nothing staged, the diff is empty.
      throw new Error("Nothing staged. Run `git add <files>` first.");
    }
    throw new Error("Nothing staged. Run `git add <files>` first.");
  }

  // Step 4: enforce 4000-line cap
  const lineCount = diff.split("\n").length;
  if (lineCount > MAX_DIFF_LINES) {
    throw new Error(
      `Diff too large for auto-generation (${lineCount} lines). Stage a smaller set of changes.`,
    );
  }

  // Step 5: scan for secrets (warn, let caller decide to proceed)
  if (!opts.secretsSendAnyway) {
    const secrets = scanForSecrets(diff);
    if (secrets.length > 0) {
      const names = [...new Set(secrets.map((s) => s.name))].join(", ");
      throw new SecretWarningError(
        `Possible secret detected in diff (${names}). Use --send-anyway to proceed, or cancel and unstage the file.`,
        secrets,
      );
    }
  }

  // Step 6: call the fast model
  const format = config.commit?.format ?? "conventional";
  const prompt = COMMIT_PROMPT(diff, format);
  const agent = new Agent({ config, learnings: "" });
  const raw = await agent.run(prompt, {
    modelOverride: config.fast_model ?? config.model,
  });

  const message = raw.trim();
  if (!message) {
    return null;
  }

  return { message, diffStat: diffStat || "(initial commit)" };
}

/**
 * Thrown when the diff contains a suspected secret pattern.
 * Caller can prompt the user and retry with secretsSendAnyway: true.
 */
export class SecretWarningError extends Error {
  constructor(
    message: string,
    public readonly matches: ReturnType<typeof scanForSecrets>,
  ) {
    super(message);
    this.name = "SecretWarningError";
  }
}

// ---------------------------------------------------------------------------
// Interactive flow: prompt + commit (step 7-8)
// ---------------------------------------------------------------------------

/**
 * Full commit flow: build message, prompt user, run git commit.
 * Called by the `phase2s commit` subcommand.
 */
export async function runCommitFlow(
  config: Config,
  opts: CommitFlowOptions = {},
): Promise<void> {
  let result: CommitMessageResult | null = null;
  let secretsSendAnyway = false;

  // Build the message, handling secret warnings interactively.
  while (true) {
    try {
      result = await buildCommitMessage(config, { secretsSendAnyway });
      break;
    } catch (err) {
      if (err instanceof SecretWarningError) {
        if (opts.auto) {
          // --auto is non-interactive: fail fast on detected secrets
          console.error(chalk.red(`✗ ${err.message}`));
          process.exit(1);
        }
        // Interactive: warn and ask
        console.log(chalk.yellow(`\n⚠  ${err.message}`));
        const rl = createRl();
        try {
          const answer = await ask(rl, "  [s]end anyway / [c]ancel: ");
          if (answer.toLowerCase().startsWith("s")) {
            secretsSendAnyway = true;
            // loop again with secretsSendAnyway = true
            continue;
          } else {
            console.log(chalk.dim("Commit cancelled."));
            return;
          }
        } finally {
          rl.close();
        }
      }
      // Other errors (not a git repo, nothing staged, diff too large): display and exit
      console.error(chalk.red(`✗ ${(err as Error).message}`));
      process.exit(1);
    }
  }

  if (result === null) {
    // Model returned empty response
    if (opts.auto) {
      console.error(chalk.red("✗ Model returned no message. Commit aborted."));
      process.exit(1);
    }
    // Interactive fallback: ask user to write manually
    console.log(chalk.yellow("Model returned no message."));
    console.log(chalk.dim(`Staged changes:\n${result ?? "(no diff stat)"}`));
    const rl = createRl();
    try {
      const manual = await ask(rl, "Write your own commit message (or press Enter to cancel): ");
      if (!manual.trim()) {
        console.log(chalk.dim("Commit cancelled."));
        return;
      }
      await commitWithMessage(manual.trim());
      return;
    } finally {
      rl.close();
    }
  }

  const { message, diffStat } = result;

  // --preview: print and exit
  if (opts.preview) {
    console.log(chalk.bold("\nProposed commit message:"));
    console.log(chalk.cyan(message));
    console.log(chalk.dim(`\nStaged changes:\n${diffStat}`));
    console.log(chalk.dim("\nNote: your diff is sent to your configured LLM provider to generate this message."));
    return;
  }

  // --auto: commit immediately
  if (opts.auto) {
    console.log(chalk.dim(`Proposed: ${message}`));
    await commitWithMessage(message);
    return;
  }

  // Interactive mode: show proposed message and prompt
  console.log(chalk.bold("\nProposed commit message:"));
  console.log(chalk.cyan(`  ${message}`));
  console.log(chalk.dim(`\nStaged changes:\n${diffStat}`));
  console.log();

  const rl = createRl();
  try {
    const answer = await ask(rl, "[a]ccept / [e]dit / [c]ancel: ");
    const key = answer.toLowerCase().trim();

    if (key.startsWith("a") || key === "") {
      await commitWithMessage(message);
    } else if (key.startsWith("e")) {
      const edited = await openEditor(message);
      if (edited === null) {
        console.log(chalk.dim("Commit cancelled."));
        return;
      }
      await commitWithMessage(edited);
    } else {
      console.log(chalk.dim("Commit cancelled."));
    }
  } finally {
    rl.close();
  }
}

// ---------------------------------------------------------------------------
// Helpers: editor and git commit
// ---------------------------------------------------------------------------

/**
 * Open $EDITOR with the proposed message pre-filled.
 * Returns the edited message, or null if the editor exited non-zero or the
 * file was left empty.
 */
async function openEditor(initialMessage: string): Promise<string | null> {
  const editor = process.env.EDITOR || process.env.VISUAL;

  if (!editor) {
    // Fallback: inline readline
    const rl = createRl();
    try {
      const edited = await ask(rl, `Edit message (current: ${initialMessage}): `);
      return edited.trim() || null;
    } finally {
      rl.close();
    }
  }

  // Write to a temp file
  let tmpFile: string | null = null;
  try {
    const tmpDir = mkdtempSync(join(tmpdir(), "phase2s-commit-"));
    tmpFile = join(tmpDir, "COMMIT_EDITMSG");
    writeFileSync(tmpFile, initialMessage, "utf8");

    // Open editor (spawnSync so we inherit stdin/stdout for interactive editing)
    const result = spawnSync(editor, [tmpFile], { stdio: "inherit" });

    if (result.status !== 0) {
      return null; // Editor exited non-zero → treat as cancel
    }

    if (!existsSync(tmpFile)) {
      return null;
    }

    const edited = readFileSync(tmpFile, "utf8").trim();
    return edited || null; // empty file → cancel
  } finally {
    if (tmpFile && existsSync(tmpFile)) {
      try { unlinkSync(tmpFile); } catch { /* best effort */ }
    }
  }
}

/**
 * Run `git commit -m message` and surface the result.
 * Exits the process on hook failure.
 */
async function commitWithMessage(message: string): Promise<void> {
  const { ok, output } = runGitCommit(message);
  if (ok) {
    console.log(chalk.green(`✓ Committed: ${message}`));
    if (output) console.log(chalk.dim(output));
  } else {
    console.error(chalk.red("✗ Commit failed (hook or git error):"));
    if (output) console.error(output);
    process.exit(1);
  }
}
