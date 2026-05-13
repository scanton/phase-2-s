/**
 * phase2s web dashboard — POST /api/runs spawn handler (Sprint 98)
 *
 * Spawns `phase2s conduct <spec-path> [--parallel] [--model fast|smart]`
 * as a child process. Pipes stdout/stderr to the run log JSONL file.
 * Existing SSE endpoint streams from that file unchanged.
 *
 * Run ID: ts-slug in format YYYY-MM-DDTHH-mm-ss-SSS (23 chars, millisecond
 * precision to prevent collision on same-second requests).
 *
 * Run log path: .phase2s/runs/<ts-slug>-<ts-slug>.jsonl
 *   The "-<ts-slug>" suffix matches findRunLogPath's `*-${id}.jsonl`
 *   pattern with zero changes to stream.ts discovery logic.
 *
 * Spec file path: .phase2s/specs/<ts-slug>-<template|freeform>.md
 *
 * Body:  { goal: string, template?: string, modelTier: "fast"|"smart", parallel: boolean }
 * Response: { id: string }  // ts-slug — browser redirects to /runs/<id>
 */

import { writeFile, mkdir, appendFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import type { Request, Response } from "express";
import { runLint } from "./lint.js";

// ---------------------------------------------------------------------------
// Allowed template names — validated before any shell-exec (C4 security fix)
// ---------------------------------------------------------------------------

const ALLOWED_TEMPLATES = new Set(["auth", "api", "bug", "refactor", "test", "cli"]);

// ---------------------------------------------------------------------------
// In-memory child process tracking — Map<ts-slug, ChildProcess>
// Entries deleted on child exit.
// ---------------------------------------------------------------------------

export const activeChildren = new Map<string, ChildProcess>();

// Kill all tracked children — called by serve.ts shutdown handler on SIGTERM/SIGINT.
// Not a module-level process.on() because serve.ts registers its own SIGTERM handler
// before spawn.ts is lazy-imported, so a listenerCount guard would silently skip this.
export function killAllChildren(): void {
  for (const child of activeChildren.values()) {
    try {
      child.kill("SIGTERM");
    } catch {
      // ignore
    }
  }
}

// ---------------------------------------------------------------------------
// tsSlug — generate a YYYY-MM-DDTHH-mm-ss slug (matches existing file naming)
// ---------------------------------------------------------------------------

export function tsSlug(): string {
  // Include milliseconds to avoid collision when two requests arrive in the same second.
  // Format: YYYY-MM-DDTHH-mm-ss-SSS (23 chars, filesystem-safe)
  return new Date().toISOString().replace(/[:.]/g, "-").replace("Z", "").slice(0, 23);
}

// ---------------------------------------------------------------------------
// buildSpecContent — produce minimal spec markdown for freeform goals
// ---------------------------------------------------------------------------

export function buildSpecContent(goal: string, _template?: string): string {
  return [
    `# Goal: ${goal.slice(0, 80)}`,
    "",
    "## Goal",
    goal,
    "",
    "## Context",
    "Browser-initiated run via Phase2S web dashboard.",
    "",
    "## Success",
    "The goal above is accomplished and all relevant tests pass.",
    "",
    "## Constraints",
    "Follow existing code style and conventions in this project.",
    "",
    "## Notes",
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// getTemplateContent — shell out to `phase2s template use <name>`
// Returns the template markdown string on success, throws on error.
// ---------------------------------------------------------------------------

async function getTemplateContent(template: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";

    const child = spawn("phase2s", ["template", "use", template], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      reject(new Error(`phase2s not found: ${err.message}`));
    });

    child.on("close", (code) => {
      if (code === 0 && stdout.trim()) {
        resolve(stdout);
      } else {
        reject(new Error(`Template failed (exit ${code}): ${stderr.trim() || "no output"}`));
      }
    });
  });
}

// ---------------------------------------------------------------------------
// POST /api/runs
// ---------------------------------------------------------------------------

export async function handlePostRuns(
  req: Request,
  res: Response,
  cwd: string,
): Promise<void> {
  const {
    goal,
    template,
    modelTier = "smart",
    parallel = false,
  } = req.body as {
    goal?: string;
    template?: string;
    modelTier?: "fast" | "smart";
    parallel?: boolean;
  };

  if (!goal || typeof goal !== "string" || !goal.trim()) {
    res.status(400).json({ error: "goal is required" });
    return;
  }

  if (goal.length > 2000) {
    res.status(400).json({ error: "goal must be 2000 characters or fewer" });
    return;
  }

  if (typeof parallel !== "boolean") {
    res.status(400).json({ error: "parallel must be a boolean" });
    return;
  }

  if (modelTier !== "fast" && modelTier !== "smart") {
    res.status(400).json({ error: "modelTier must be \"fast\" or \"smart\"" });
    return;
  }

  // Basic concurrency cap — prevents fd exhaustion from rapid-fire submissions
  if (activeChildren.size >= 10) {
    res.status(429).json({ error: "Too many runs in progress. Wait for one to finish." });
    return;
  }

  // C4: allowlist template before any shell-exec
  if (template && !ALLOWED_TEMPLATES.has(template)) {
    res.status(400).json({ error: `Unknown template: ${template}` });
    return;
  }

  const id = tsSlug();
  const specsDir = join(cwd, ".phase2s", "specs");
  const runsDir = join(cwd, ".phase2s", "runs");
  const templateSlug = template ?? "freeform";
  const specPath = join(specsDir, `${id}-${templateSlug}.md`);
  // Run log uses "<ts-slug>-<ts-slug>.jsonl" so findRunLogPath matches on `*-${id}.jsonl`
  const runLogPath = join(runsDir, `${id}-${id}.jsonl`);

  try {
    await mkdir(specsDir, { recursive: true });
    await mkdir(runsDir, { recursive: true });

    // Step 1: generate spec content
    let specContent: string;
    if (template) {
      try {
        specContent = await getTemplateContent(template);
        // Prepend the user's goal as a comment above the template
        specContent = `<!-- Goal: ${goal} -->\n\n${specContent}`;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(400).json({ error: message });
        return;
      }
    } else {
      specContent = buildSpecContent(goal);
    }

    await writeFile(specPath, specContent, "utf8");

    // Step 2: server-side authoritative lint gate
    const { valid, errors } = await runLint(specPath);
    if (!valid) {
      // Clean up spec file — run was rejected, no reason to persist user's goal text
      unlink(specPath).catch(() => undefined);
      res.status(400).json({ error: errors.join("; ") });
      return;
    }

    // Step 3: spawn conduct child
    const args = ["conduct", specPath];
    if (parallel) args.push("--parallel");
    if (modelTier === "fast") args.push("--model", "fast");

    const child = spawn("phase2s", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Pipe stdout + stderr to run log (line-buffered JSONL)
    const pipeToLog = (chunk: Buffer): void => {
      appendFile(runLogPath, chunk.toString(), "utf8").catch(() => undefined);
    };
    child.stdout?.on("data", pipeToLog);
    child.stderr?.on("data", pipeToLog);

    // Track child; remove on exit
    activeChildren.set(id, child);
    child.on("exit", () => {
      activeChildren.delete(id);
    });
    child.on("error", () => {
      activeChildren.delete(id);
    });

    // Step 4: return id immediately — browser redirects to live view
    res.json({ id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
}
