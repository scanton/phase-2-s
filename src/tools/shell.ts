import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, sep } from "node:path";
import type { ToolDefinition, ToolResult } from "./types.js";

const execFileAsync = promisify(execFile);

/** Patterns that suggest a destructive or exfiltration-risk command. */
const DESTRUCTIVE_PATTERNS = [
  /rm\s+-[a-zA-Z]*r[a-zA-Z]*f/,     // rm -rf variants
  /rm\s+-[a-zA-Z]*f[a-zA-Z]*r/,     // rm -fr variants
  /\bcurl\b.*\|\s*(ba)?sh/,         // curl | sh / curl | bash
  /\bwget\b.*\|\s*(ba)?sh/,         // wget | sh
  /git\s+push\s+.*--force/,         // git push --force
  /git\s+push\s+-f\b/,              // git push -f
  /:\s*>\s*\S+/,                    // : > file (truncate via colon)
  /\bdd\b.*of=\/dev\//,             // dd to device files
  /\bchmod\s+777\b/,                // world-writable permission
  /\bsudo\b/,                       // sudo escalation
];

const params = z.object({
  command: z.string().describe("Shell command to execute"),
  timeout: z.number().min(1_000).max(300_000).optional().describe("Timeout in milliseconds (default: 30000, max: 300000)"),
  cwd: z.string().optional().describe("Working directory for the command (defaults to project directory)"),
});

export const shellTool: ToolDefinition = {
  name: "shell",
  description: "Execute a shell command and return its output. Use for running builds, tests, git commands, etc.",
  parameters: params,
  async execute(raw: unknown): Promise<ToolResult> {
    const args = params.parse(raw);
    const timeout = args.timeout ?? 30_000;

    // Warn on destructive patterns — log to stdout so the user sees it
    for (const pattern of DESTRUCTIVE_PATTERNS) {
      if (pattern.test(args.command)) {
        process.stdout.write(`  [shell] ⚠ Potentially destructive command: ${args.command}\n`);
        break;
      }
    }

    // Sandbox: reject cwd values that escape the project directory
    const projectRoot = process.cwd();
    let cwdPath = projectRoot;
    if (args.cwd) {
      const resolvedCwd = resolve(args.cwd);
      if (!resolvedCwd.startsWith(projectRoot + sep) && resolvedCwd !== projectRoot) {
        return {
          success: false,
          output: "",
          error: `cwd outside project directory: ${args.cwd}`,
        };
      }
      cwdPath = resolvedCwd;
    }

    try {
      const { stdout, stderr } = await execFileAsync("/bin/sh", ["-c", args.command], {
        timeout,
        maxBuffer: 1024 * 1024 * 10, // 10MB
        cwd: cwdPath,
      });

      // Return stdout and stderr separately so the LLM gets accurate signal
      const parts: string[] = [];
      if (stdout) parts.push(stdout);
      if (stderr) parts.push(`[stderr]\n${stderr}`);
      return { success: true, output: parts.join("\n") || "(no output)" };
    } catch (err: unknown) {
      if (err && typeof err === "object" && "stdout" in err) {
        const execErr = err as { stdout: string; stderr: string; code: number | null; killed: boolean; signal: string | null };
        const parts: string[] = [];
        if (execErr.stdout) parts.push(execErr.stdout);
        if (execErr.stderr) parts.push(`[stderr]\n${execErr.stderr}`);
        const errorMsg = execErr.killed
          ? `Command timed out after ${timeout}ms`
          : `Command exited with code ${execErr.code}`;
        return {
          success: false,
          output: parts.join("\n"),
          error: errorMsg,
        };
      }
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, output: "", error: msg };
    }
  },
};
