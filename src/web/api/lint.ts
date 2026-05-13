/**
 * phase2s web dashboard — POST /api/lint (Sprint 98)
 *
 * Runs `phase2s lint` on a temporary spec derived from the form input.
 * Advisory only — the caller (browser lint button) shows errors inline
 * but the Run button stays enabled regardless of lint result.
 * POST /api/runs performs the authoritative lint gate server-side.
 *
 * Body:  { goal: string, template?: string }
 * Response: { valid: boolean, errors: string[] }
 */

import { writeFile, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import type { Request, Response } from "express";
import { buildSpecContent } from "./spawn.js";

// ---------------------------------------------------------------------------
// POST /api/lint
// ---------------------------------------------------------------------------

export async function handlePostLint(
  req: Request,
  res: Response,
): Promise<void> {
  const { goal, template } = req.body as { goal?: string; template?: string };

  if (!goal || typeof goal !== "string" || !goal.trim()) {
    res.status(400).json({ error: "goal is required" });
    return;
  }

  // Write a temp spec file for linting — cleaned up after lint exits
  const tmpDir = join(tmpdir(), `phase2s-lint-${Date.now()}`);
  const specPath = join(tmpDir, "lint-spec.md");

  try {
    await mkdir(tmpDir, { recursive: true });
    await writeFile(specPath, buildSpecContent(goal, template), "utf8");

    const { valid, errors } = await runLint(specPath);
    res.json({ valid, errors });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  } finally {
    // Best-effort cleanup
    unlink(specPath).catch(() => undefined);
    import("node:fs/promises")
      .then(({ rmdir }) => rmdir(tmpDir))
      .catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// runLint — spawn `phase2s lint <specPath>` and collect output
// ---------------------------------------------------------------------------

export async function runLint(
  specPath: string,
): Promise<{ valid: boolean; errors: string[] }> {
  return new Promise((resolve) => {
    let stderr = "";
    let stdout = "";

    const child = spawn("phase2s", ["lint", specPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      resolve({ valid: false, errors: [`phase2s not found: ${err.message}`] });
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ valid: true, errors: [] });
      } else {
        // Parse errors from stdout/stderr — lint outputs to stdout
        const raw = (stdout + stderr).trim();
        const errors = raw
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);
        resolve({ valid: false, errors: errors.length > 0 ? errors : ["Lint failed"] });
      }
    });
  });
}
