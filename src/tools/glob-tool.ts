import { z } from "zod";
import { glob } from "glob";
import { resolve, sep } from "node:path";
import type { ToolDefinition, ToolResult } from "./types.js";

const params = z.object({
  pattern: z.string().describe("Glob pattern to match files (e.g. '**/*.ts')"),
  cwd: z.string().optional().describe("Base directory to search from"),
  ignore: z.array(z.string()).optional().describe("Patterns to ignore"),
});

export const globTool: ToolDefinition = {
  name: "glob",
  description: "Find files matching a glob pattern. Returns matching file paths.",
  parameters: params,
  async execute(raw: unknown): Promise<ToolResult> {
    const args = params.parse(raw);

    // Sandbox: validate the cwd parameter stays inside the project
    const projectRoot = process.cwd();
    const cwdPath = args.cwd ? resolve(args.cwd) : projectRoot;
    if (!cwdPath.startsWith(projectRoot + sep) && cwdPath !== projectRoot) {
      return { success: false, output: "", error: `cwd outside project directory: ${args.cwd}` };
    }

    try {
      const files = await glob(args.pattern, {
        cwd: cwdPath,
        ignore: args.ignore ?? ["node_modules/**", ".git/**"],
        nodir: true,
      });

      if (files.length === 0) {
        return { success: true, output: "No files matched the pattern." };
      }

      return { success: true, output: files.join("\n") };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, output: "", error: msg };
    }
  },
};
