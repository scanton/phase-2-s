import { z } from "zod";
import { writeFile, mkdir, access } from "node:fs/promises";
import { resolve, dirname, sep } from "node:path";
import type { ToolDefinition, ToolResult } from "./types.js";

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
    const fullPath = resolve(args.path);
    const projectRoot = process.cwd();

    // Sandbox: reject paths outside the project directory
    if (!fullPath.startsWith(projectRoot + sep) && fullPath !== projectRoot) {
      return {
        success: false,
        output: "",
        error: `Path outside project directory: ${args.path}`,
      };
    }

    // Guard: reject empty writes to existing files (silent truncation is data loss)
    if (args.content === "") {
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

      if (args.createDirs) {
        await mkdir(dirname(fullPath), { recursive: true });
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
