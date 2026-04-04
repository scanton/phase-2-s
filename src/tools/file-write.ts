import { z } from "zod";
import { writeFile, mkdir, access } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import type { ToolDefinition, ToolResult } from "./types.js";
import { assertInSandbox } from "./sandbox.js";

/** Sanitize an error message before returning it to the LLM — strip absolute paths. */
function sanitizeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/,\s*open\s+'[^']*'/g, "").replace(/\/[^\s']*/g, "<path>");
}

const params = z.object({
  path: z.string().describe("Path to the file to write (relative to project directory)"),
  content: z.string().describe("Content to write to the file"),
  createDirs: z.boolean().optional().describe("Create parent directories if they don't exist"),
});

export const fileWriteTool: ToolDefinition = {
  name: "file_write",
  description: "Write content to a file. Creates the file if it doesn't exist. Paths are relative to the project directory.",
  parameters: params,
  async execute(raw: unknown): Promise<ToolResult> {
    const args = params.parse(raw);

    // For files that need createDirs, we need to mkdir first so that
    // realpath() can resolve the parent directory. We use a lexical resolve
    // pre-check before mkdir, then assertInSandbox after dirs exist.
    const lexicalFullPath = resolve(args.path);

    if (args.createDirs) {
      // Pre-check using lexical resolve before creating dirs (prevents creating
      // dirs outside the project before we can realpath-check them).
      const { sep } = await import("node:path");
      const cwd = process.cwd();
      if (!lexicalFullPath.startsWith(cwd + sep) && lexicalFullPath !== cwd) {
        return {
          success: false,
          output: "",
          error: `Path outside project directory: ${args.path}`,
        };
      }
      await mkdir(dirname(lexicalFullPath), { recursive: true });
    }

    // Sandbox: reject paths outside the project directory (realpath-based, blocks symlink escapes)
    // After dirs are created, realpath() can resolve the parent reliably.
    let fullPath: string;
    try {
      fullPath = await assertInSandbox(args.path);
    } catch (err) {
      return {
        success: false,
        output: "",
        error: err instanceof Error ? err.message : `Path outside project directory: ${args.path}`,
      };
    }

    // Guard: reject near-empty writes to existing files (silent truncation is data loss).
    // Trim check catches whitespace-only content that would also effectively destroy a file.
    if (args.content.trim() === "") {
      try {
        await access(fullPath);
        // File exists — refuse the empty write
        return {
          success: false,
          output: "",
          error: `Refusing to truncate existing file to empty: ${args.path}. Pass non-empty content.`,
        };
      } catch {
        // File doesn't exist — writing empty is fine (creates the file)
      }
    }

    try {
      // Check if file exists to produce an informative log
      let existed = false;
      try {
        await access(fullPath);
        existed = true;
      } catch {
        // doesn't exist
      }

      await writeFile(fullPath, args.content, "utf-8");

      const verb = existed ? "Overwrote" : "Wrote";
      if (existed) {
        process.stdout.write(`  [file_write] Overwriting existing file: ${args.path}\n`);
      }
      return { success: true, output: `${verb} ${args.content.length} bytes to ${args.path}` };
    } catch (err: unknown) {
      return { success: false, output: "", error: sanitizeError(err) };
    }
  },
};
