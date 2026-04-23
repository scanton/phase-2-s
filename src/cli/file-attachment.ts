/**
 * @file fuzzy attachment for the interactive REPL.
 *
 * Provides Tab completion for @path tokens and inline file content injection
 * at submission time. Files are inlined into the agent's context as a preamble
 * block prepended before the user's message text.
 *
 * Usage in interactiveMode():
 *   completer: makeCompleter(() => process.cwd())   — wired into createInterface
 *   expandAttachments(trimmed, process.cwd())        — called before command dispatch
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { assertInSandbox } from "../tools/sandbox.js";

// Regex: negative lookbehind ensures @ is NOT preceded by a word char.
// Blocks email false positives (user@domain.com) while matching:
//   @src/core/agent.ts  @Makefile  @Dockerfile  @.env
const ATTACH_TOKEN_RE = /(?<!\w)@([\w./\-_]+)/g;

// 20KB hard limit regardless of line count (blocks minified/binary files)
const MAX_BYTES = 20 * 1024;

// ---------------------------------------------------------------------------
// Types

export type SizeWarning = "none" | "warned" | "truncated";

export interface AttachedFile {
  path: string;
  resolvedPath: string;
  content: string;
  lineCount: number;
  sizeWarning: SizeWarning;
}

// ---------------------------------------------------------------------------
// parseAttachTokens

/**
 * Extract all @path tokens from a line.
 * Returns the path strings without the leading @.
 */
export function parseAttachTokens(line: string): string[] {
  const tokens: string[] = [];
  let match: RegExpExecArray | null;
  ATTACH_TOKEN_RE.lastIndex = 0;
  while ((match = ATTACH_TOKEN_RE.exec(line)) !== null) {
    tokens.push(match[1]);
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// readWithSizeGuard

/**
 * Read a file with path traversal guard and size limits.
 * Uses assertInSandbox() (async realpath + symlink check) for traversal safety.
 */
export async function readWithSizeGuard(
  token: string,
  cwd: string,
  maxLines = 200,
): Promise<AttachedFile | { error: string }> {
  let resolvedPath: string;
  try {
    resolvedPath = await assertInSandbox(token, cwd);
  } catch {
    return { error: `Path outside project directory: ${token}` };
  }

  let raw: string;
  try {
    // Check byte size before reading full content
    const stat = statSync(resolvedPath);
    if (stat.isDirectory()) {
      return { error: `Path is a directory: ${token}` };
    }
    if (!stat.isFile()) {
      return { error: `Not a regular file: ${token}` };
    }
    if (stat.size > MAX_BYTES) {
      return { error: `File too large to attach (>${Math.round(MAX_BYTES / 1024)}KB): ${token}` };
    }
    raw = readFileSync(resolvedPath, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { error: `File not found: ${token}` };
    if (code === "EISDIR") return { error: `Path is a directory: ${token}` };
    return { error: `Could not read file: ${token}` };
  }

  const lines = raw.split("\n");
  const lineCount = lines.length;

  let sizeWarning: SizeWarning;
  let content: string;

  if (lineCount > 500) {
    sizeWarning = "truncated";
    content = lines.slice(0, maxLines).join("\n") + "\n[truncated]";
  } else if (lineCount > 200) {
    sizeWarning = "warned";
    content = raw;
  } else {
    sizeWarning = "none";
    content = raw;
  }

  return {
    path: token,
    resolvedPath,
    content,
    lineCount,
    sizeWarning,
  };
}

// ---------------------------------------------------------------------------
// formatAttachmentBlock

/**
 * Format attached files as a context preamble block to prepend before the
 * user's message.
 */
export function formatAttachmentBlock(files: AttachedFile[]): string {
  if (files.length === 0) return "";
  const escapeXml = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return (
    files
      .map((f) => `<file path="${f.path}">\n${escapeXml(f.content)}\n</file>`)
      .join("\n") + "\n"
  );
}

// ---------------------------------------------------------------------------
// makeCompleter

/**
 * Build a readline async completer for @token Tab completion.
 *
 * The completer receives the line buffer up to the cursor. It finds the last
 * @fragment at the end of the buffer (the active token) and returns matching
 * file paths as completions. The active fragment is returned as the substring
 * so readline replaces only that fragment on Tab — not the full line.
 */
export function makeCompleter(
  getCwd: () => string,
): (line: string, callback: (err: Error | null, result: [string[], string]) => void) => void {
  return (line: string, callback): void => {
    // Find the active @fragment at the end of the line (up to cursor)
    const match = line.match(/@[\w./\-_]*$/);
    if (!match) {
      callback(null, [[], ""]);
      return;
    }

    const activeToken = match[0]; // e.g. "@src/core/ag"
    const fragment = activeToken.slice(1); // strip leading @

    const cwd = getCwd();
    const dirPart = fragment.includes("/") ? dirname(fragment) : "";
    const filePart = fragment.includes("/") ? basename(fragment) : fragment;

    const searchDir = dirPart ? join(cwd, dirPart) : cwd;

    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(searchDir, { withFileTypes: true });
    } catch {
      callback(null, [[], activeToken]);
      return;
    }

    const completions = entries
      .filter((entry) => entry.name.startsWith(filePart))
      .map((entry) => {
        const relPath = dirPart ? dirPart + "/" + entry.name : entry.name;
        return "@" + relPath + (entry.isDirectory() ? "/" : "");
      });

    callback(null, [completions, activeToken]);
  };
}

// ---------------------------------------------------------------------------
// expandAttachments

/**
 * Expand @tokens in a line. For each valid token, reads the file and builds
 * a preamble block. On error, writes to stderr and preserves the original
 * @token in cleanLine.
 *
 * Returns:
 *   cleanLine — line with successfully-attached @tokens removed
 *   preamble  — formatted file content block (empty string if no attachments)
 *   attached  — metadata for successfully attached files
 */
export async function expandAttachments(
  line: string,
  cwd: string,
): Promise<{ cleanLine: string; preamble: string; attached: AttachedFile[] }> {
  const tokens = parseAttachTokens(line);
  if (tokens.length === 0) {
    return { cleanLine: line, preamble: "", attached: [] };
  }

  const attached: AttachedFile[] = [];
  let cleanLine = line;

  for (const token of [...new Set(tokens)]) {
    const result = await readWithSizeGuard(token, cwd);
    if ("error" in result) {
      process.stderr.write(`[phase2s] Could not attach ${token}: ${result.error}\n`);
      // Preserve the @token in cleanLine — don't silently remove it
    } else {
      attached.push(result);
      // Remove @token but only when not followed by more path chars (avoids corrupting longer tokens)
      const tokenRe = new RegExp(
        "(?<!\\w)@" + token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![\\w./\\-_])",
        "g",
      );
      cleanLine = cleanLine.replace(tokenRe, "").replace(/\s{2,}/g, " ").trim();
    }
  }

  const preamble = formatAttachmentBlock(attached);
  return { cleanLine, preamble, attached };
}
