/**
 * phase2s web dashboard — /api/runs handlers (Sprint 94–99)
 *
 * GET /api/runs              — return ConductLogEntry[] (newest first)
 *   ?search=<text>           — case-insensitive substring match on goal
 *   ?status=success|failure  — filter by terminal status
 *   ?after=<iso>             — runs started after this timestamp (ISO 8601)
 *   ?before=<iso>            — runs started before this timestamp (ISO 8601)
 * GET /api/runs/:id          — return { entry, spec, runLog } for a given specHash
 *
 * Path traversal guard: realpath-resolved path must start with cwd.
 * Uses fs.realpath (not path.resolve) to dereference symlinks — prevents
 * a symlink in .phase2s/ from bypassing the guard.
 */

import { readFile, realpath, readdir } from "node:fs/promises";
import { join, sep } from "node:path";
import type { Request, Response } from "express";
import { readConductLog } from "../../cli/conduct-log.js";
import type { ConductLogEntry } from "../../cli/conduct-log.js";
import type { RunEvent } from "../../core/run-logger.js";
import { isActiveRun } from "./active.js";

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

const VALID_STATUSES = new Set(["success", "failure"]);

export async function handleGetRuns(
  req: Request,
  res: Response,
  cwd: string,
): Promise<void> {
  const q = req.query as Record<string, unknown>;
  const search = typeof q.search === "string" ? q.search : undefined;
  const status = typeof q.status === "string" ? q.status : undefined;
  const after = typeof q.after === "string" ? q.after : undefined;
  const before = typeof q.before === "string" ? q.before : undefined;

  // Validate ?search length
  if (search !== undefined && search.length > 512) {
    res.status(400).json({ error: "search too long (max 512 characters)" });
    return;
  }

  // Validate ?status
  if (status !== undefined && !VALID_STATUSES.has(status)) {
    res.status(400).json({ error: "status must be one of: success, failure" });
    return;
  }

  // Validate ?after and ?before as ISO 8601
  let afterMs: number | undefined;
  let beforeMs: number | undefined;
  if (after !== undefined) {
    const d = new Date(after);
    if (isNaN(d.getTime())) {
      res.status(400).json({ error: "Invalid date format for 'after'" });
      return;
    }
    afterMs = d.getTime();
  }
  if (before !== undefined) {
    const d = new Date(before);
    if (isNaN(d.getTime())) {
      res.status(400).json({ error: "Invalid date format for 'before'" });
      return;
    }
    beforeMs = d.getTime();
  }

  // Validate before > after
  if (afterMs !== undefined && beforeMs !== undefined && beforeMs <= afterMs) {
    res.status(400).json({ error: "'before' must be later than 'after'" });
    return;
  }

  try {
    let entries = await readConductLog(cwd);

    if (search) {
      const needle = search.toLowerCase();
      entries = entries.filter((e) => e.goal.toLowerCase().includes(needle));
    }

    if (status === "success") {
      entries = entries.filter((e) => e.success === true);
    } else if (status === "failure") {
      entries = entries.filter((e) => e.success === false);
    }

    if (afterMs !== undefined) {
      const threshold = afterMs;
      entries = entries.filter((e) => new Date(e.ts).getTime() > threshold);
    }
    if (beforeMs !== undefined) {
      const ceiling = beforeMs;
      entries = entries.filter((e) => new Date(e.ts).getTime() < ceiling);
    }

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
  /** Server-computed: true if the run log exists and has no terminal event within 30 min */
  isActive: boolean;
}

// ---------------------------------------------------------------------------
// buildSyntheticEntry — create a ConductLogEntry from a run log file for
// active runs that haven't been written to the conduct log yet.
// ---------------------------------------------------------------------------

async function buildSyntheticEntry(
  runLogPath: string,
  specHash: string,
  startedAt: string,
  projectRoot: string,
): Promise<{ entry: ConductLogEntry; runLog: RunEvent[] } | null> {
  let raw: string;
  try {
    raw = await readFile(runLogPath, "utf8");
  } catch {
    return null;
  }

  const runLog: RunEvent[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      runLog.push(JSON.parse(trimmed) as RunEvent);
    } catch {
      // Skip malformed lines
    }
  }

  // Extract metadata from events
  let goal = "Active run";
  let subtaskCount = 0;
  let specPath = "";
  for (const ev of runLog) {
    if (ev.event === "goal_started") {
      const e = ev as { event: string; specFile?: string; subTaskCount?: number };
      if (e.specFile) specPath = e.specFile;
      if (e.subTaskCount) subtaskCount = e.subTaskCount;
      // Try to read goal from spec file — assertInProject guard prevents
      // a crafted log from reading arbitrary files via e.specFile.
      if (e.specFile) {
        try {
          await assertInProject(e.specFile, projectRoot);
          const specContent = await readFile(e.specFile, "utf8");
          const firstHeading = specContent.match(/^#\s+(.+)$/m);
          if (firstHeading) goal = firstHeading[1].trim();
        } catch {
          // Spec not readable, doesn't exist, or outside project — use placeholder
        }
      }
      break;
    }
    if (ev.event === "orchestrator_started") {
      const e = ev as { event: string; specHash?: string; totalJobs?: number };
      if (e.totalJobs) subtaskCount = e.totalJobs;
    }
  }

  const entry: ConductLogEntry = {
    ts: startedAt,
    goal,
    specPath,
    specHash,
    subtaskCount,
    roles: [],
    success: false,
    durationMs: Date.now() - new Date(startedAt).getTime(),
    runLogPath,
    rounds: 0,
  };

  return { entry, runLog };
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
  // Validate specHash — prevents unexpected filesystem patterns in file lookups.
  // Legacy ts-slug fallback also passes this since it only uses \d and hyphens,
  // but those won't match the 8-char hex check. Keep it permissive for legacy:
  if (id.length > 0 && !/^[a-f0-9]{8}$/.test(id) && !/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/.test(id)) {
    res.status(400).json({ error: "Invalid run id format" });
    return;
  }

  try {
    const entries = await readConductLog(cwd);

    // Match by specHash (8-char hex from Sprint 90+) or by ts-slug (legacy)
    let entry: ConductLogEntry | undefined =
      entries.find((e) => e.specHash === id) ??
      entries.find((e) => {
        // Legacy fallback: id might be a URL-safe ts slug like "2024-01-15T10-30-00"
        const tsSlug = e.ts.replace(/[:.]/g, "-").slice(0, id.length);
        return tsSlug === id;
      });

    // Fallback: scan .phase2s/runs/ for an active run not yet in the conduct log
    let runLogFromDir: string | null = null;
    let startedAtFromDir: string | null = null;
    if (!entry) {
      const runsDir = join(cwd, ".phase2s", "runs");
      try {
        const files = await readdir(runsDir);
        const match = files.find((f) => f.endsWith(`-${id}.jsonl`));
        if (match) {
          runLogFromDir = join(runsDir, match);
          const tsMatch = match.match(/^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})/);
          if (tsMatch) {
            startedAtFromDir = tsMatch[1].replace(/T(\d{2})-(\d{2})-(\d{2})$/, "T$1:$2:$3");
          }
        }
      } catch {
        // Runs directory doesn't exist
      }

      if (!runLogFromDir) {
        res.status(404).json({ error: `Run not found: ${id}` });
        return;
      }
    }

    // Read spec file
    let spec: string | null = null;
    let runLog: RunEvent[] | null = null;

    if (entry) {
      // Normal path: conduct log entry exists
      if (entry.specPath) {
        try {
          await assertInProject(entry.specPath, cwd);
          spec = await readFile(entry.specPath, "utf8");
        } catch {
          // Spec file missing, symlink outside project, or path traversal — return null
        }
      }

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
    } else {
      // Fallback path: active run not yet in conduct log
      const synthetic = await buildSyntheticEntry(
        runLogFromDir!,
        id,
        startedAtFromDir ?? new Date().toISOString(),
        cwd,
      );
      if (!synthetic) {
        res.status(404).json({ error: `Run not found: ${id}` });
        return;
      }
      entry = synthetic.entry;
      runLog = synthetic.runLog;

      // Read spec file from synthetic entry
      if (entry.specPath) {
        try {
          await assertInProject(entry.specPath, cwd);
          spec = await readFile(entry.specPath, "utf8");
        } catch {
          // Spec not readable
        }
      }
    }

    // Compute isActive
    const logPath = entry.runLogPath;
    let active = false;
    if (logPath) {
      try {
        await assertInProject(logPath, cwd);
        active = await isActiveRun(logPath);
      } catch {
        // Can't check — treat as inactive
      }
    }

    const detail: RunDetail = { entry, spec, runLog, isActive: active };
    res.json(detail);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
}
