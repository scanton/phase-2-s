import { z } from "zod";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import type { ToolDefinition, ToolResult } from "./types.js";

const params = z.object({
  path: z.string().describe("Path to the file to write"),
  content: z.string().describe("Content to write to the file"),
  createDirs: z.boolean().optional().describe("Create parent directories if they don't exist"),
});

export const fileWriteTool: ToolDefinition = {
  name: "file_write",
  description: "Write content to a file. Creates the file if it doesn't exist.",
  parameters: params,
  async execute(raw: unknown): Promise<ToolResult> {
    const args = params.parse(raw);
    const fullPath = resolve(args.path);

    try {
      if (args.createDirs) {
        await mkdir(dirname(fullPath), { recursive: true });
      }
      await writeFile(fullPath, args.content, "utf-8");
      return { success: true, output: `Wrote ${args.content.length} bytes to ${args.path}` };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, output: "", error: msg };
    }
  },
};
