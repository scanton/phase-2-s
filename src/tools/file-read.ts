import { z } from "zod";
import { readFile } from "node:fs/promises";
import type { ToolDefinition, ToolResult } from "./types.js";
import { assertInSandbox } from "./sandbox.js";

const params = z.object({
  path: z.string().describe("Path to the file to read (relative to project directory)"),
  startLine: z.number().min(1).optional().describe("Start reading from this line (1-based)"),
  endLine: z.number().min(1).optional().describe("Stop reading at this line (inclusive)"),
});

/** Sanitize an error message before returning it to the LLM — strip absolute paths. */
function sanitizeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  // Remove absolute paths from error strings (e.g. ENOENT: no such file or directory, open '/home/user/...')
  return msg.replace(/,\s*open\s+'[^']*'/g, "").replace(/\/[^\s']*/g, "<path>");
}

export const fileReadTool: ToolDefinition = {
  name: "file_read",
  description: "Read the contents of a file. Optionally specify a line range. Paths are relative to the project directory.",
  parameters: params,
  async execute(raw: unknown): Promise<ToolResult> {
    const args = params.parse(raw);

    // Sandbox: reject paths outside the project directory (realpath-based, blocks symlink escapes)
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

    try {
      const content = await readFile(fullPath, "utf-8");

      if (args.startLine !== undefined || args.endLine !== undefined) {
        const lines = content.split("\n");
        const start = (args.startLine ?? 1) - 1;  // already validated min(1), so min index is 0
        const end = args.endLine ?? lines.length;
        const slice = lines.slice(start, end);
        const numbered = slice.map((line, i) => `${start + i + 1}\t${line}`);
        return { success: true, output: numbered.join("\n") };
      }

      return { success: true, output: content };
    } catch (err: unknown) {
      return { success: false, output: "", error: sanitizeError(err) };
    }
  },
};
