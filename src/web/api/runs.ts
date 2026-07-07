/**
 * phase2s web dashboard — /api/runs handlers (Sprint 94–99)
 *
 * GET /api/runs              — return ConductLogEntry[] (newest first)
 *   ?search=<text>           — case-insensitive substring match on goal
 *   ?status=success|failure  — filter by terminal status
 *   ?after=<iso>             — runs started after this timestamp (ISO 8601)
 *   ?before=<iso>            — runs started before this timestamp (ISO 8601)
 *   ?limit=<n>&offset=<m>    — paginate (Sprint 101). With either param the
 *                              response is { runs, total, hasMore }; without
 *                              both, the legacy bare array is returned.
 * GET /api/runs/:id          — return { entry, spec, runLog } for a given specHash
 *
 * Path traversal guard: realpath-resolved path must start with cwd.
 * Uses fs.realpath (not path.resolve) to dereference symlinks — prevents
 * a symlink in .phase2s/ from bypassing the guard.
 */

import { readFile, realpath, readdir, stat } from "node:fs/promises";
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

// ---------------------------------------------------------------------------
// Conduct-log cache — the server is long-lived and the runs list is the
// hottest endpoint. Cache the parsed log keyed on file mtime+size; every
// request pays one stat() instead of a full read+parse of a file that only
// changes when a run completes.
//
// mtime+size is safe here because the conduct log is append-only: size is
// strictly monotonic, so a rewrite-with-equal-length within the mtime
// resolution window (the classic mtime-cache blind spot) cannot occur.
// ---------------------------------------------------------------------------

let runsCache: {
  logPath: string;
  mtimeMs: number;
  size: number;
  entries: ConductLogEntry[];
} | null = null;

async function readConductLogCached(cwd: string): Promise<ConductLogEntry[]> {
  const logPath = join(cwd, ".phase2s", "conduct-log.jsonl");
  let mtimeMs: number;
  let size: number;
  try {
    const s = await stat(logPath);
    mtimeMs = s.mtimeMs;
    size = s.size;
  } catch {
    runsCache = null;
    return [];
  }

  if (
    runsCache &&
    runsCache.logPath === logPath &&
    runsCache.mtimeMs === mtimeMs &&
    runsCache.size === size
  ) {
    return runsCache.entries;
  }

  const entries = await readConductLog(cwd);
  runsCache = { logPath, mtimeMs, size, entries };
  return entries;
}

/** Test-only: reset the runs cache between test cases. */
export function _clearRunsCache(): void {
  runsCache = null;
}

// Hard ceiling on ?limit so a bad client can't request the moon and defeat
// the point of pagination.
const MAX_PAGE_LIMIT = 500;

/** Parse a non-negative integer query param; null = invalid, undefined = absent. */
function parseNonNegativeInt(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "string" || !/^\d+$/.test(v)) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : null;
}

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

  // Pagination (Sprint 101). When either param is present the response shape
  // becomes { runs, total, hasMore }; with neither, the legacy bare array is
  // returned so existing clients keep working.
  const limit = parseNonNegativeInt(q.limit);
  const offset = parseNonNegativeInt(q.offset);
  if (limit === null || (limit !== undefined && (limit === 0 || limit > MAX_PAGE_LIMIT))) {
    res.status(400).json({ error: `limit must be an integer between 1 and ${MAX_PAGE_LIMIT}` });
    return;
  }
  if (offset === null) {
    res.status(400).json({ error: "offset must be a non-negative integer" });
    return;
  }

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
    let entries = await readConductLogCached(cwd);

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

    if (limit !== undefined || offset !== undefined) {
      const start = offset ?? 0;
      const pageSize = limit ?? 50;
      const page = entries.slice(start, start + pageSize);
      res.json({
        runs: page,
        total: entries.length,
        hasMore: start + page.length < entries.length,
      });
      return;
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
    const entries = await readConductLogCached(cwd);

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
