import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ToolDefinition, ToolResult } from "./types.js";

const execFileAsync = promisify(execFile);

const params = z.object({
  command: z.string().describe("Shell command to execute"),
  timeout: z.number().optional().describe("Timeout in milliseconds (default: 30000)"),
  cwd: z.string().optional().describe("Working directory for the command"),
});

export const shellTool: ToolDefinition = {
  name: "shell",
  description: "Execute a shell command and return its output. Use for running builds, tests, git commands, etc.",
  parameters: params,
  async execute(raw: unknown): Promise<ToolResult> {
    const args = params.parse(raw);
    const timeout = args.timeout ?? 30_000;

    try {
      const { stdout, stderr } = await execFileAsync("/bin/sh", ["-c", args.command], {
        timeout,
        maxBuffer: 1024 * 1024 * 10, // 10MB
        cwd: args.cwd,
      });

      const output = [stdout, stderr].filter(Boolean).join("\n");
      return { success: true, output: output || "(no output)" };
    } catch (err: unknown) {
      if (err && typeof err === "object" && "stdout" in err) {
        const execErr = err as { stdout: string; stderr: string; code: number };
        const output = [execErr.stdout, execErr.stderr].filter(Boolean).join("\n");
        return {
          success: false,
          output,
          error: `Command exited with code ${execErr.code}`,
        };
      }
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, output: "", error: msg };
    }
  },
};
