/**
 * phase2s web dashboard — /api/runs/:id/stream SSE handler (Sprint 95)
 *
 * GET /api/runs/:id/stream
 *   Server-Sent Events endpoint that tails a run's JSONL file.
 *
 * Flow:
 *   1. Find run JSONL file in .phase2s/runs/ (does NOT require conduct log entry,
 *      so active-but-not-yet-logged runs are streamable too)
 *   2. Send all existing events as catch-up on connect
 *   3. setInterval(100ms): read new bytes since last offset
 *      ⚠️  res.write() is wrapped in try/catch — on any error, clearInterval
 *          and return. req.on('close') is the primary cleanup path; try/catch
 *          is the fallback for EPIPE races between disconnect and next tick.
 *   4. On terminal event → send "event: close\ndata: {}\n\n" + res.end()
 *   5. On client disconnect → clearInterval
 *
 * Path traversal guard: run log path must be inside cwd.
 */

import { open, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Request, Response } from "express";
import { readConductLog } from "../../cli/conduct-log.js";
import { TERMINAL_EVENTS } from "../../core/run-logger.js";
import { assertInProject } from "./runs.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 100;

// ---------------------------------------------------------------------------
// findRunLogPath — locate run JSONL without requiring conduct log entry
// ---------------------------------------------------------------------------

/**
 * Find the run log path for a given specHash.
 * First scans .phase2s/runs/ directly (works for active runs not yet in
 * conduct log), then falls back to the conduct log entry.
 */
export async function findRunLogPath(
  cwd: string,
  specHash: string,
): Promise<string | null> {
  // Primary: scan runs directory for <timestamp>-<specHash>.jsonl
  const runsDir = join(cwd, ".phase2s", "runs");
  try {
    const files = await readdir(runsDir);
    const match = files.find((f) => f.endsWith(`-${specHash}.jsonl`));
    if (match) return join(runsDir, match);
  } catch {
    // Directory doesn't exist yet — fall through to conduct log
  }

  // Fallback: conduct log entry
  const entries = await readConductLog(cwd);
  const entry = entries.find((e) => e.specHash === specHash);
  return entry?.runLogPath ?? null;
}

// ---------------------------------------------------------------------------
// GET /api/runs/:id/stream
// ---------------------------------------------------------------------------

export async function handleGetRunStream(
  req: Request,
  res: Response,
  cwd: string,
): Promise<void> {
  const { id } = req.params;
  if (!id) {
    res.status(400).json({ error: "Missing run id" });
    return;
  }
  // Validate specHash format — prevents unexpected filesystem glob patterns
  if (!/^[a-f0-9]{8}$/.test(id)) {
    res.status(400).json({ error: "Invalid run id format" });
    return;
  }

  // Find run log path
  let runLogPath: string | null = null;
  try {
    runLogPath = await findRunLogPath(cwd, id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
    return;
  }
  if (!runLogPath) {
    res.status(404).json({ error: `Run not found: ${id}` });
    return;
  }
  // Path traversal guard — 403 only for traversal, other errors bubble as 500
  try {
    await assertInProject(runLogPath, cwd);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(403).json({ error: message });
    return;
  }

  const logPath = runLogPath;

  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering
  res.flushHeaders();

  let offset = 0;
  let done = false;
  let intervalId: ReturnType<typeof setInterval> | null = null;

  const cleanup = (): void => {
    if (done) return;
    done = true;
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };

  // Client disconnect handler — primary cleanup path
  req.on("close", cleanup);

  // -------------------------------------------------------------------------
  // sendCatchUp — replay all existing file content on connect
  // Returns true if a terminal event was found (run already complete)
  // -------------------------------------------------------------------------

  const sendCatchUp = async (): Promise<boolean> => {
    try {
      const fileHandle = await open(logPath, "r");
      try {
        const s = await fileHandle.stat();
        if (s.size === 0) return false;
        const buf = Buffer.alloc(s.size);
        await fileHandle.read(buf, 0, s.size, 0);
        offset = s.size;
        let foundTerminal = false;
        for (const line of buf.toString("utf8").split("\n")) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const ev = JSON.parse(trimmed) as { event: string };
            // ⚠️  try/catch on write — EPIPE fallback for race with disconnect
            try {
              res.write(`data: ${JSON.stringify(ev)}\n\n`);
            } catch {
              cleanup();
              return true;
            }
            if (TERMINAL_EVENTS.has(ev.event)) foundTerminal = true;
          } catch {
            continue;
          }
        }
        return foundTerminal;
      } finally {
        await fileHandle.close();
      }
    } catch {
      return false;
    }
  };

  // -------------------------------------------------------------------------
  // poll — read new bytes since last offset, push to client
  // -------------------------------------------------------------------------

  const poll = async (): Promise<void> => {
    if (done) return;
    try {
      const fileHandle = await open(logPath, "r");
      try {
        const s = await fileHandle.stat();
        if (s.size <= offset) return;
        const newBytes = s.size - offset;
        const buf = Buffer.alloc(newBytes);
        await fileHandle.read(buf, 0, newBytes, offset);
        offset = s.size;
        for (const line of buf.toString("utf8").split("\n")) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const ev = JSON.parse(trimmed) as { event: string };
            // ⚠️  try/catch — EPIPE fallback for race with client disconnect
            try {
              res.write(`data: ${JSON.stringify(ev)}\n\n`);
            } catch {
              cleanup();
              return;
            }
            if (TERMINAL_EVENTS.has(ev.event)) {
              // Run complete — signal close
              try {
                res.write("event: close\ndata: {}\n\n");
              } catch {
                /* ignore — client may have disconnected */
              }
              cleanup();
              res.end();
              return;
            }
          } catch {
            continue;
          }
        }
      } finally {
        await fileHandle.close();
      }
    } catch {
      // File may not exist yet or was deleted — keep polling
    }
  };

  // Send catch-up; if run already finished, close immediately
  const alreadyDone = await sendCatchUp();
  if (alreadyDone) {
    try {
      res.write("event: close\ndata: {}\n\n");
    } catch {
      /* ignore */
    }
    cleanup();
    res.end();
    return;
  }

  if (done) return; // Client disconnected during catch-up

  // Start polling for new events
  intervalId = setInterval(() => {
    poll().catch(() => cleanup());
  }, POLL_INTERVAL_MS);
}
