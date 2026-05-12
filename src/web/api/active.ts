/**
 * phase2s web dashboard — /api/runs/active handler (Sprint 95)
 *
 * GET /api/runs/active
 *   Scans .phase2s/runs/*.jsonl for runs that are:
 *     1. Modified within the last 30 minutes (active window)
 *     2. Do NOT end with a terminal event (orchestrator_completed / goal_completed / goal_error)
 *
 *   Returns: { runs: ActiveRun[] } sorted newest-first.
 *
 * ⚠️  TERMINAL_EVENTS is imported from run-logger.ts — do NOT redefine locally.
 */

import { open, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Request, Response } from "express";
import { TERMINAL_EVENTS } from "../../core/run-logger.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACTIVE_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

// ---------------------------------------------------------------------------
// ActiveRun type
// ---------------------------------------------------------------------------

export interface ActiveRun {
  specHash: string;
  startedAt: string;
  runLogPath: string;
}

// ---------------------------------------------------------------------------
// readFileTail — read the last `maxBytes` from a file without a full read
// ---------------------------------------------------------------------------

/**
 * Read the last `maxBytes` bytes of `filePath` using a file descriptor and
 * a calculated offset. Much cheaper than reading the whole file for large logs.
 */
export async function readFileTail(
  filePath: string,
  maxBytes: number,
): Promise<string> {
  const fileHandle = await open(filePath, "r");
  try {
    const s = await fileHandle.stat();
    if (s.size === 0) return "";
    const offset = Math.max(0, s.size - maxBytes);
    const readSize = Math.min(maxBytes, s.size);
    const buf = Buffer.alloc(readSize);
    await fileHandle.read(buf, 0, readSize, offset);
    return buf.toString("utf8");
  } finally {
    await fileHandle.close();
  }
}

// ---------------------------------------------------------------------------
// isActiveRun
// ---------------------------------------------------------------------------

/**
 * Return true if the given JSONL run log file represents an in-progress run.
 *
 * A run is "active" if:
 *   1. Its file was modified within the last 30 minutes
 *   2. Its last few lines do NOT contain a terminal event
 */
export async function isActiveRun(filePath: string): Promise<boolean> {
  const s = await stat(filePath);
  if (Date.now() - s.mtimeMs > ACTIVE_WINDOW_MS) return false;
  if (s.size === 0) return false;
  const tail = await readFileTail(filePath, Math.min(2048, s.size));
  for (const line of tail.split("\n").reverse()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const ev = JSON.parse(trimmed) as { event: string };
      if (TERMINAL_EVENTS.has(ev.event)) return false;
    } catch {
      continue;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// GET /api/runs/active
// ---------------------------------------------------------------------------

export async function handleGetActiveRuns(
  _req: Request,
  res: Response,
  cwd: string,
): Promise<void> {
  try {
    const runsDir = join(cwd, ".phase2s", "runs");
    let files: string[];
    try {
      files = await readdir(runsDir);
    } catch {
      // Directory doesn't exist yet — no active runs
      res.json({ runs: [] });
      return;
    }

    const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));
    const activeRuns: ActiveRun[] = [];

    for (const file of jsonlFiles) {
      const filePath = join(runsDir, file);
      try {
        const active = await isActiveRun(filePath);
        if (!active) continue;

        // Filename: <YYYY-MM-DDTHH-MM-SS>-<hash8>.jsonl
        const match = file.match(/^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})-([a-f0-9]{8})\.jsonl$/);
        if (!match) continue;

        const specHash = match[2];
        // Convert filesystem-safe timestamp back to ISO 8601
        const startedAt = match[1].replace(/T(\d{2})-(\d{2})-(\d{2})$/, "T$1:$2:$3");

        activeRuns.push({ specHash, startedAt, runLogPath: filePath });
      } catch {
        // Skip files we can't read
      }
    }

    // Newest first
    activeRuns.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    res.json({ runs: activeRuns });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
}
