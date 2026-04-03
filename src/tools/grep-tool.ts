import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, sep } from "node:path";
import type { ToolDefinition, ToolResult } from "./types.js";

const execFileAsync = promisify(execFile);

const params = z.object({
  pattern: z.string().describe("Regex pattern to search for"),
  path: z.string().optional().describe("File or directory to search (default: current directory)"),
  filePattern: z.string().optional().describe("Only search files matching this glob (e.g. '*.ts')"),
  caseSensitive: z.boolean().optional().describe("Case sensitive search (default: true)"),
  maxResults: z.number().optional().describe("Maximum number of results (default: 50)"),
});

export const grepTool: ToolDefinition = {
  name: "grep",
  description: "Search file contents for a regex pattern. Returns matching lines with file paths and line numbers.",
  parameters: params,
  async execute(raw: unknown): Promise<ToolResult> {
    const args = params.parse(raw);
    const grepArgs = ["-rn", "--color=never"];

    if (!args.caseSensitive && args.caseSensitive !== undefined) {
      grepArgs.push("-i");
    }

    if (args.filePattern) {
      grepArgs.push("--include", args.filePattern);
    }

    // Always exclude common noise
    grepArgs.push("--exclude-dir=node_modules", "--exclude-dir=.git", "--exclude-dir=dist");

    grepArgs.push(args.pattern);

    // Sandbox: resolve and validate the search path
    const projectRoot = process.cwd();
    const searchPath = args.path ? resolve(args.path) : projectRoot;
    if (!searchPath.startsWith(projectRoot + sep) && searchPath !== projectRoot) {
      return { success: false, output: "", error: `Path outside project directory: ${args.path}` };
    }
    grepArgs.push(searchPath);

    try {
      const { stdout } = await execFileAsync("grep", grepArgs, {
        maxBuffer: 1024 * 1024 * 5,
        timeout: 15_000,
      });

      const lines = stdout.trim().split("\n");
      const maxResults = args.maxResults ?? 50;
      const truncated = lines.slice(0, maxResults);

      let output = truncated.join("\n");
      if (lines.length > maxResults) {
        output += `\n\n... (${lines.length - maxResults} more results truncated)`;
      }

      return { success: true, output };
    } catch (err: unknown) {
      if (err && typeof err === "object" && "code" in err && (err as { code: number }).code === 1) {
        return { success: true, output: "No matches found." };
      }
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, output: "", error: msg };
    }
  },
};
