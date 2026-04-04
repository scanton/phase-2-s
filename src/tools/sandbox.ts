import { realpath } from "node:fs/promises";
import { resolve, sep, dirname, basename } from "node:path";

/**
 * Shared sandbox enforcement helper.
 *
 * Resolves `filePath` to its real (symlink-expanded) absolute path and
 * verifies it lives inside `cwd` (also resolved via realpath).
 *
 * Why realpath() instead of resolve()?
 * `path.resolve()` does lexical normalization only — it cannot follow symlinks.
 * A symlink at `<project>/link -> /etc` would pass a `resolve()`-based check
 * because the resolved path starts with the project root. `realpath()` follows
 * the chain and returns `/etc`, which correctly fails the sandbox check.
 *
 * Edge cases:
 * - File does not exist: realpath() throws ENOENT. We catch it and fall back
 *   to lexical resolve() for the sandbox check. The caller (file_write with
 *   createDirs) must ensure parent dirs exist before calling assertInSandbox
 *   when it needs the realpath guarantee for a new file.
 * - Dangling symlink (points to non-existent target): realpath() throws. We
 *   catch it and return a sandbox error WITHOUT leaking the absolute path in
 *   the error message (the raw realpath error would expose it).
 * - `cwd` itself: we realpath() it once per call, which is cheap and correct.
 *
 * @param filePath  The user-supplied (potentially relative) file path.
 * @param cwd       The project root to sandbox against. Defaults to process.cwd().
 * @returns         The resolved absolute path (realpath or lexical fallback).
 * @throws          Error with a safe message if the path escapes the sandbox.
 */
export async function assertInSandbox(
  filePath: string,
  cwd: string = process.cwd(),
): Promise<string> {
  // Resolve cwd via realpath to handle the case where cwd itself is a symlink.
  let realCwd: string;
  try {
    realCwd = await realpath(cwd);
  } catch {
    // cwd doesn't exist or isn't accessible — use lexical fallback
    realCwd = resolve(cwd);
  }

  // Attempt to resolve the file path via realpath (follows symlinks).
  let resolvedPath: string;
  let usedRealpath = true;
  try {
    resolvedPath = await realpath(resolve(cwd, filePath));
  } catch (err) {
    // File doesn't exist yet (ENOENT) OR is a dangling symlink.
    // For ENOENT we fall back to lexical resolve (safe — new files can't escape
    // the sandbox via lexical path alone).
    // For other errors (dangling symlinks, permission issues) we conservatively
    // block rather than risk leaking data or paths.
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      // File doesn't exist yet. Try realpath() on the parent directory to catch
      // the case where the parent is a symlink pointing outside cwd.
      // e.g. <project>/exfil -> /etc, then write to exfil/newfile.txt must be blocked.
      const absFilePath = resolve(cwd, filePath);
      const parentDir = dirname(absFilePath);
      try {
        const realParent = await realpath(parentDir);
        // Parent exists and was realpath'd — compose the final path from the real parent.
        resolvedPath = realParent + sep + basename(absFilePath);
        // usedRealpath remains true — we have a realpath-based parent.
      } catch {
        // Parent also doesn't exist (multi-level new path) — lexical fallback.
        // This is safe because lexical normalization prevents `../` escapes.
        resolvedPath = absFilePath;
        usedRealpath = false;
      }
    } else {
      // Dangling symlink or other error — block without leaking the path.
      throw new Error(`Path outside project directory: ${filePath}`);
    }
  }

  // Sandbox check: resolved path must be inside cwd.
  const sandboxRoot = usedRealpath ? realCwd : resolve(cwd);
  if (!resolvedPath.startsWith(sandboxRoot + sep) && resolvedPath !== sandboxRoot) {
    throw new Error(`Path outside project directory: ${filePath}`);
  }

  return resolvedPath;
}
