/**
 * `phase2s conversations` — session browser.
 *
 * Lists all sessions in .phase2s/sessions/, sorted newest-first.
 * Launches an fzf browser if fzf is in PATH; falls back to a plain-text
 * table for non-interactive environments.
 *
 * fzf keybindings:
 *   Enter    — print the selected session UUID to stdout
 *   Escape / ctrl-c — exit with no selection
 *
 * The session UUID is shown in the fzf preview pane so users can copy it
 * for use with :clone.
 */

import { execFile, execFileSync } from "node:child_process";
import chalk from "chalk";
import { listSessions, getSessionPreview, sanitizeForTerminal, type SessionMeta } from "../core/session.js";

// ---------------------------------------------------------------------------
// Row type
// ---------------------------------------------------------------------------

interface SessionRow {
  id: string;
  date: string;
  branchName: string;
  parentId: string | null;
  preview: string;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Run the conversations browser in the given directory.
 * Returns the selected session UUID, or null if the user cancelled / no fzf.
 */
export async function runConversationsBrowser(cwd: string): Promise<string | null> {
  const sessions = await listSessions(cwd);

  if (sessions.length === 0) {
    console.log(chalk.dim("No sessions found. Start one with: phase2s"));
    return null;
  }

  const rows = await buildRows(sessions);

  if (hasFzf() && process.stdout.isTTY) {
    return runFzf(rows);
  } else {
    printTable(rows);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Row building
// ---------------------------------------------------------------------------

async function buildRows(sessions: Array<{ meta: SessionMeta; path: string }>): Promise<SessionRow[]> {
  return Promise.all(
    sessions.map(async ({ meta, path }) => {
      const preview = await getSessionPreview(path);
      return {
        id: meta.id,
        date: meta.createdAt.slice(0, 10),
        // Sanitize branchName before it enters fzf input lines — prevents ANSI/OSC
        // injection if a crafted session file has escape sequences in branchName.
        branchName: sanitizeForTerminal(meta.branchName ?? "main"),
        parentId: meta.parentId,
        preview: preview || "(empty session)",
      };
    }),
  );
}

// ---------------------------------------------------------------------------
// fzf browser
// ---------------------------------------------------------------------------

function hasFzf(): boolean {
  try {
    execFileSync("fzf", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function runFzf(rows: SessionRow[]): Promise<string | null> {
  // Each fzf line: "YYYY-MM-DD  branchName  preview\x00uuid"
  // delimiter=\x00, with-nth=1 shows only the display portion
  // preview pane echoes {2} (the UUID field)
  const fzfInput = rows
    .map((r) => {
      const branch = r.branchName.slice(0, 20).padEnd(20);
      const preview = r.preview.slice(0, 55);
      return `${r.date}  ${branch}  ${preview}\x00${r.id}`;
    })
    .join("\n");

  return new Promise((resolve) => {
    const fzf = execFile(
      "fzf",
      [
        "--ansi",
        "--no-sort",
        "--delimiter=\x00",
        "--with-nth=1",
        "--preview=echo UUID: {2}",
        "--preview-window=right:35%:wrap",
        "--header=Enter: resume  Ctrl-C: cancel",
        "--prompt=session > ",
      ],
      { encoding: "utf-8" },
      (err, stdout) => {
        if (err || !stdout.trim()) {
          resolve(null);
          return;
        }
        // stdout is the full selected line including the null-delimited UUID
        const nullIdx = stdout.indexOf("\x00");
        const id = nullIdx !== -1 ? stdout.slice(nullIdx + 1).trim() : null;
        resolve(id);
      },
    );

    fzf.stdin?.write(fzfInput);
    fzf.stdin?.end();
  });
}

// ---------------------------------------------------------------------------
// Plain-text fallback
// ---------------------------------------------------------------------------

function printTable(rows: SessionRow[]): void {
  const divider = chalk.dim("─".repeat(82));
  console.log(chalk.bold("\nSessions (newest first):"));
  console.log(divider);
  console.log(chalk.bold("DATE        BRANCH                PREVIEW"));
  console.log(divider);

  for (const r of rows) {
    const branch = r.branchName.slice(0, 20).padEnd(20);
    const preview = r.preview.slice(0, 42);
    console.log(`${r.date}  ${branch}  ${preview}`);
    console.log(chalk.dim(`            UUID: ${r.id}`));
  }

  console.log(divider);
  console.log(chalk.dim("\nTo resume: phase2s conversations  (select from this list)"));
  console.log(chalk.dim("To clone:  :clone <uuid>  (inside the REPL)"));
}
