import { z } from "zod";
import { writeFile, mkdir, access } from "node:fs/promises";
import { resolve, sep, dirname, basename } from "node:path";
import { realpath } from "node:fs/promises";
import type { ToolDefinition, ToolResult } from "./types.js";

/** Sanitize an error message before returning it to the LLM — strip absolute paths. */
function sanitizeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/,\s*open\s+'[^']*'/g, "").replace(/\/[^\s']*/g, "<path>");
}

const params = z.object({
  path: z.string().describe("Path to write (must be inside the plans/ directory, e.g. plans/my-plan.md)"),
  content: z.string().describe("Content to write to the plan file"),
});

/**
 * Create a sandboxed plans_write tool for the given project root.
 *
 * The tool rejects any write path that resolves outside `<cwd>/plans/`.
 *
 * Sandbox rules (mirror of assertInSandbox, scoped to plans/):
 *   - Uses realpath() on the parent directory for existing parents.
 *   - Falls back to lexical resolve() for ENOENT (new files/dirs).
 *   - Separator-aware: checks startsWith(plansDir + sep), not startsWith(plansDir).
 *     This prevents "plans-evil/" from matching "plans/".
 *   - Auto-creates the plans/ directory on first write.
 */
export function createPlansWriteTool(cwd: string): ToolDefinition {
  const plansDir = resolve(cwd, "plans");

  async function resolvePlansPath(rawPath: string): Promise<string | null> {
    const absPath = resolve(cwd, rawPath);
    const parentDir = dirname(absPath);
    const fileName = basename(absPath);

    // Attempt realpath on the parent directory.
    let realParent: string;
    try {
      realParent = await realpath(parentDir);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        // Parent doesn't exist yet (new nested path) — use lexical resolution.
        // Lexical normalization prevents ../ escapes, so this is safe.
        realParent = parentDir;
      } else {
        // Dangling symlink or permission error — block.
        return null;
      }
    }

    return realParent + sep + fileName;
  }

  async function assertInPlansSandbox(rawPath: string): Promise<string> {
    // Resolve cwd/plans via realpath so symlinked project roots work correctly.
    let realPlansDir: string;
    let plansDirExists = false;
    try {
      realPlansDir = await realpath(plansDir);
      plansDirExists = true;
    } catch {
      // plans/ doesn't exist yet — use lexical path.
      realPlansDir = plansDir;
    }

    // Guard: plans/ itself must not be a symlink pointing outside cwd.
    // Without this check, if plans/ → /outside, realPlansDir = "/outside" and the
    // startsWith check below would pass for any write to /outside/... (symlink escape).
    // Only apply when plans/ exists: if it doesn't exist it can't yet be a symlink,
    // and using realpath(cwd) here would produce a different-prefix path on macOS
    // (where /var → /private/var) that would falsely block legitimate temp-dir writes.
    if (plansDirExists) {
      let realCwd: string;
      try { realCwd = await realpath(cwd); } catch { realCwd = cwd; }
      if (realPlansDir !== realCwd && !realPlansDir.startsWith(realCwd + sep)) {
        throw new Error("plans/ directory resolves outside the project — symlink escape blocked");
      }
    }

    const resolved = await resolvePlansPath(rawPath);
    if (resolved === null) {
      throw new Error("Path outside plans directory");
    }

    // Separator-aware prefix check: path must be INSIDE plans/ (not plans/ itself).
    // "plans/" must not match "plans-evil/" and writing to "plans" dir itself is rejected.
    if (!resolved.startsWith(realPlansDir + sep)) {
      throw new Error(`Path outside plans directory: ${rawPath}`);
    }

    return resolved;
  }

  return {
    name: "plans_write",
    description:
      "Write a plan file to the plans/ directory. Only paths inside plans/ are allowed. " +
      "Creates the plans/ directory automatically if it does not exist. " +
      "Use this to write implementation plans, design docs, and specs.",
    parameters: params,
    async execute(raw: unknown): Promise<ToolResult> {
      const args = params.parse(raw);

      let fullPath: string;
      try {
        fullPath = await assertInPlansSandbox(args.path);
      } catch (err) {
        return {
          success: false,
          output: "",
          error: err instanceof Error ? err.message : `Path outside plans directory: ${args.path}`,
        };
      }

      // Guard: refuse to truncate an existing file to empty.
      if (args.content.trim() === "") {
        try {
          await access(fullPath);
          return {
            success: false,
            output: "",
            error: `Refusing to truncate existing plan file to empty: ${args.path}`,
          };
        } catch {
          // File doesn't exist — writing empty is fine
        }
      }

      try {
        // Auto-create plans/ and any intermediate directories.
        await mkdir(dirname(fullPath), { recursive: true });
        // NOTE: TOCTOU — assertInPlansSandbox ran above, mkdir ran here. A symlink
        // swap between those two calls is theoretically possible but requires local
        // filesystem access. The symlink-escape guard in assertInPlansSandbox already
        // blocks the most dangerous case (plans/ itself being a symlink). Per-file
        // O_NOFOLLOW is not cleanly exposed by Node.js writeFile; risk is accepted as low.

        let existed = false;
        try {
          await access(fullPath);
          existed = true;
        } catch {
          // doesn't exist
        }

        await writeFile(fullPath, args.content, "utf-8");

        const verb = existed ? "Overwrote" : "Wrote";
        return { success: true, output: `${verb} ${args.content.length} bytes to ${args.path}` };
      } catch (err: unknown) {
        return { success: false, output: "", error: sanitizeError(err) };
      }
    },
  };
}
