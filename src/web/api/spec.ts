/**
 * phase2s web dashboard — /api/spec handler (Sprint 94)
 *
 * GET /api/spec?path=<specPath>
 *
 * Reads the spec file at the given path and returns it as text/markdown.
 * Path traversal guard: realpath-resolved path must start with cwd
 * (see assertInProject in runs.ts — symlink-safe).
 */

import { readFile } from "node:fs/promises";
import type { Request, Response } from "express";
import { assertInProject } from "./runs.js";

export async function handleGetSpec(
  req: Request,
  res: Response,
  cwd: string,
): Promise<void> {
  const specPath = req.query["path"];
  if (typeof specPath !== "string" || !specPath) {
    res.status(400).json({ error: "Missing ?path= query parameter" });
    return;
  }

  try {
    await assertInProject(specPath, cwd);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // assertInProject can throw "path traversal detected" or ENOENT
    const isTraversal = message.includes("path traversal");
    // Return sanitized messages — raw ENOENT includes absolute filesystem paths
    res
      .status(isTraversal ? 403 : 404)
      .json({ error: isTraversal ? "Access denied" : "Spec file not found" });
    return;
  }

  try {
    const content = await readFile(specPath, "utf8");
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.send(content);
  } catch {
    res.status(404).json({ error: "Spec file not found" });
  }
}
