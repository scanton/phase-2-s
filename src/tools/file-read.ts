import { z } from "zod";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ToolDefinition, ToolResult } from "./types.js";

const params = z.object({
  path: z.string().describe("Path to the file to read"),
  startLine: z.number().optional().describe("Start reading from this line (1-based)"),
  endLine: z.number().optional().describe("Stop reading at this line (inclusive)"),
});

export const fileReadTool: ToolDefinition = {
  name: "file_read",
  description: "Read the contents of a file. Optionally specify a line range.",
  parameters: params,
  async execute(raw: unknown): Promise<ToolResult> {
    const args = params.parse(raw);
    const fullPath = resolve(args.path);

    try {
      const content = await readFile(fullPath, "utf-8");

      if (args.startLine || args.endLine) {
        const lines = content.split("\n");
        const start = (args.startLine ?? 1) - 1;
        const end = args.endLine ?? lines.length;
        const slice = lines.slice(start, end);
        const numbered = slice.map((line, i) => `${start + i + 1}\t${line}`);
        return { success: true, output: numbered.join("\n") };
      }

      return { success: true, output: content };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, output: "", error: msg };
    }
  },
};
