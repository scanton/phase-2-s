/**
 * phase2s web dashboard — /api/runs handlers (Sprint 94)
 *
 * GET /api/runs       — return all ConductLogEntry[] (newest first)
 * GET /api/runs/:id   — return { entry, spec, runLog } for a given specHash
 *
 * Path traversal guard: realpath-resolved path must start with cwd.
 * Uses fs.realpath (not path.resolve) to dereference symlinks — prevents
 * a symlink in .phase2s/ from bypassing the guard.
 */

import { readFile, realpath } from "node:fs/promises";
import { sep } from "node:path";
import type { Request, Response } from "express";
import { readConductLog } from "../../cli/conduct-log.js";
import type { ConductLogEntry } from "../../cli/conduct-log.js";
import type { RunEvent } from "../../core/run-logger.js";

// ---------------------------------------------------------------------------
// Path traversal guard
// ---------------------------------------------------------------------------

/**
 * Assert that `filePath` (after realpath resolution) is inside `projectRoot`.
 * Uses `fs.realpath` to dereference symlinks before comparing paths.
 * Throws a descriptive error if path traversal is detected.
 */
export async function assertInProject(
  filePath: string,
  projectRoot: string,
): Promise<void> {
  // realpath dereferences symlinks on both paths so macOS /var→/private/var
  // and similar symlink-prefixed temp dirs compare correctly.
  // realpath throws ENOENT if the file doesn't exist — callers catch that.
  const [resolved, root] = await Promise.all([
    realpath(filePath),
    realpath(projectRoot),
  ]);
  if (!resolved.startsWith(root + sep) && resolved !== root) {
    throw new Error(`path traversal detected: ${filePath}`);
  }
}

// ---------------------------------------------------------------------------
// GET /api/runs
// ---------------------------------------------------------------------------

export async function handleGetRuns(
  _req: Request,
  res: Response,
  cwd: string,
): Promise<void> {
  try {
    const entries = await readConductLog(cwd);
    res.json(entries);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
}

// ---------------------------------------------------------------------------
// GET /api/runs/:id
// ---------------------------------------------------------------------------

export interface RunDetail {
  entry: ConductLogEntry;
  spec: string | null;
  runLog: RunEvent[] | null;
}

export async function handleGetRunDetail(
  req: Request,
  res: Response,
  cwd: string,
): Promise<void> {
  const { id } = req.params;
  if (!id) {
    res.status(400).json({ error: "Missing run id" });
    return;
  }

  try {
    const entries = await readConductLog(cwd);

    // Match by specHash (8-char hex from Sprint 90+) or by ts-slug (legacy)
    const entry =
      entries.find((e) => e.specHash === id) ??
      entries.find((e) => {
        // Legacy fallback: id might be a URL-safe ts slug like "2024-01-15T10-30-00"
        const tsSlug = e.ts.replace(/[:.]/g, "-").slice(0, id.length);
        return tsSlug === id;
      });

    if (!entry) {
      res.status(404).json({ error: `Run not found: ${id}` });
      return;
    }

    // Read spec file
    let spec: string | null = null;
    if (entry.specPath) {
      try {
        await assertInProject(entry.specPath, cwd);
        spec = await readFile(entry.specPath, "utf8");
      } catch {
        // Spec file missing, symlink outside project, or path traversal — return null
      }
    }

    // Read run log JSONL
    let runLog: RunEvent[] | null = null;
    if (entry.runLogPath) {
      try {
        await assertInProject(entry.runLogPath, cwd);
        const raw = await readFile(entry.runLogPath, "utf8");
        runLog = [];
        for (const line of raw.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            runLog.push(JSON.parse(trimmed) as RunEvent);
          } catch {
            // Skip malformed lines
          }
        }
      } catch {
        // Run log missing, symlink outside project, or path traversal — return null
      }
    }

    const detail: RunDetail = { entry, spec, runLog };
    res.json(detail);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
}
