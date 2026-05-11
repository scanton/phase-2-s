/**
 * Progress renderer for the Conductor live progress panel.
 *
 * Three modes:
 *   'ansi'  — live in-place panel with cursor-up redraws (TTY)
 *   'plain' — plain-text log lines (CI / non-TTY)
 *   'quiet' — all methods no-op (MCP / programmatic)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProgressEvent =
  | { type: 'level_start'; levelIndex: number; totalLevels: number; jobs: Array<{ id: string; title: string }> }
  | { type: 'job_start'; jobId: string }
  | { type: 'job_complete'; jobId: string; durationMs: number }
  | { type: 'job_failed'; jobId: string; durationMs: number; error: string }
  | { type: 'job_skipped'; jobId: string }
  | { type: 'level_complete'; levelIndex: number }
  | { type: 'done'; totalDurationMs: number };

export interface ProgressRenderer {
  emit(event: ProgressEvent): void;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// formatMs helper
// ---------------------------------------------------------------------------

function formatMs(ms: number): string {
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(0)}s`;
  }
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

// ---------------------------------------------------------------------------
// Quiet renderer
// ---------------------------------------------------------------------------

function createQuietRenderer(): ProgressRenderer {
  return {
    emit(_event: ProgressEvent): void { /* no-op */ },
    dispose(): void { /* no-op */ },
  };
}

// ---------------------------------------------------------------------------
// Plain renderer
// ---------------------------------------------------------------------------

function createPlainRenderer(out: NodeJS.WriteStream): ProgressRenderer {
  // Track job titles from the most recent level_start
  const jobTitles = new Map<string, string>();

  return {
    emit(event: ProgressEvent): void {
      switch (event.type) {
        case 'level_start':
          for (const j of event.jobs) jobTitles.set(j.id, j.title);
          out.write(`[conduct] Level ${event.levelIndex + 1}/${event.totalLevels} — ${event.jobs.length} subtasks\n`);
          break;
        case 'job_start': {
          const title = jobTitles.get(event.jobId) ?? event.jobId;
          out.write(`[conduct] → ${title}\n`);
          break;
        }
        case 'job_complete': {
          const title = jobTitles.get(event.jobId) ?? event.jobId;
          out.write(`[conduct] ✓ ${title} (${formatMs(event.durationMs)})\n`);
          break;
        }
        case 'job_failed': {
          const title = jobTitles.get(event.jobId) ?? event.jobId;
          out.write(`[conduct] ✗ ${title} (${formatMs(event.durationMs)}) — ${event.error.slice(0, 80)}\n`);
          break;
        }
        case 'job_skipped': {
          const title = jobTitles.get(event.jobId) ?? event.jobId;
          out.write(`[conduct] ⊘ ${title}\n`);
          break;
        }
        case 'level_complete':
          break;
        case 'done':
          out.write(`[conduct] done — ${formatMs(event.totalDurationMs)} total\n`);
          break;
      }
    },
    dispose(): void { /* no-op */ },
  };
}

// ---------------------------------------------------------------------------
// ANSI renderer internals
// ---------------------------------------------------------------------------

type RowState = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

interface JobRow {
  id: string;
  title: string;
  state: RowState;
  startMs?: number;
  durationMs?: number;
  error?: string;
}

// ANSI color codes
const C_GREEN  = '\x1b[0;32m';
const C_RED    = '\x1b[0;31m';
const C_YELLOW = '\x1b[0;33m';
const C_DIM    = '\x1b[2m';
const C_RESET  = '\x1b[0m';

function formatElapsed(startMs: number): string {
  const ms = Date.now() - startMs;
  const totalSec = Math.floor(ms / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function formatDuration(ms: number): string {
  if (ms < 60000) return `${Math.floor(ms / 1000)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function renderRow(row: JobRow, maxTitleLen: number): string {
  // Truncate title
  let title = row.title;
  if (title.length > maxTitleLen) {
    title = title.slice(0, maxTitleLen) + '…';
  }

  const paddedTitle = title.padEnd(maxTitleLen + 1);

  switch (row.state) {
    case 'pending':
      return `${C_DIM}  ○  ${paddedTitle}—${C_RESET}`;
    case 'running': {
      const elapsed = row.startMs ? formatElapsed(row.startMs) : '00:00';
      return `${C_YELLOW}  ●  ${C_RESET}${paddedTitle}${elapsed}`;
    }
    case 'done': {
      const dur = row.durationMs !== undefined ? formatDuration(row.durationMs) : '—';
      return `${C_GREEN}  ✓  ${C_RESET}${paddedTitle}${dur}`;
    }
    case 'failed': {
      const dur = row.durationMs !== undefined ? formatDuration(row.durationMs) : '—';
      const errSnip = row.error ? ` — ${row.error.slice(0, 40)}` : '';
      return `${C_RED}  ✗  ${C_RESET}${paddedTitle}${dur}${errSnip}`;
    }
    case 'skipped':
      return `${C_DIM}  ⊘  ${paddedTitle}—${C_RESET}`;
  }
}

function renderHeader(goal: string, levelIndex: number, totalLevels: number, levelStartMs: number, cols: number): string {
  const maxGoalLen = Math.max(0, cols - 30);
  const truncatedGoal = goal.length > maxGoalLen
    ? goal.slice(0, maxGoalLen) + '…'
    : goal;

  const elapsed = formatElapsed(levelStartMs);
  const barWidth = Math.max(4, cols - 20);
  const bar = '━'.repeat(Math.min(barWidth, 30));
  return [
    `Phase2S Conductor — "${truncatedGoal}"`,
    `Level ${levelIndex + 1} of ${totalLevels}  ${bar}  ${elapsed}`,
  ].join('\n');
}

function renderFooter(rows: JobRow[]): string {
  const done    = rows.filter(r => r.state === 'done').length;
  const running = rows.filter(r => r.state === 'running').length;
  const queued  = rows.filter(r => r.state === 'pending').length;
  const failed  = rows.filter(r => r.state === 'failed').length;
  return `  ${done} done  ·  ${running} running  ·  ${queued} queued  ·  ${failed} failed`;
}

function createAnsiRenderer(goal: string, out: NodeJS.WriteStream): ProgressRenderer {
  let rows: JobRow[] = [];
  let totalJobs = 0;
  let capN = 0;
  let lineCount = 0;
  let dirty = false;
  let degraded = false;
  let levelIndex = 0;
  let totalLevels = 1;
  let levelStartMs = Date.now();
  let ticker: ReturnType<typeof setInterval> | undefined;

  // SSH detection: slower tick rate on remote sessions
  const isSSH = !!(process.env.SSH_TTY || process.env.SSH_CLIENT || process.env.SSH_CONNECTION);
  const tickMs = isSSH ? 250 : 100;

  // Detect terminal resize → degrade to flow mode
  // Capture handler so dispose() can remove it (prevents listener accumulation).
  const onResize = (): void => { degraded = true; };
  process.stdout.on('resize', onResize);

  function getMaxTitleLen(): number {
    const cols = out.columns ?? 80;
    return Math.max(1, cols - 12);
  }

  function getCapN(): number {
    const rows_ = out.rows ?? 24;
    // F13: floor at 0 to prevent negative slice args on tiny terminals (rows < 4).
    return Math.max(0, Math.min(totalJobs, rows_ - 4));
  }

  function printPanel(): void {
    const cols = out.columns ?? 80;
    const maxTitleLen = getMaxTitleLen();
    const cap = getCapN();
    const visibleRows = rows.slice(0, cap);
    const overflow = totalJobs - cap;

    const lines: string[] = [
      renderHeader(goal, levelIndex, totalLevels, levelStartMs, cols),
      '',
      ...visibleRows.map(r => renderRow(r, maxTitleLen)),
    ];
    if (overflow > 0) {
      lines.push(`${C_DIM}  …and ${overflow} more${C_RESET}`);
    }
    lines.push(renderFooter(rows));

    out.write(lines.map(l => `\r\x1b[K${l}`).join('\n') + '\n');

    // lineCount = header(2) + blank(1) + min(N, rows-4) job rows + optional overflow row + footer(1)
    lineCount = 2 + 1 + visibleRows.length + (overflow > 0 ? 1 : 0) + 1;
    capN = cap;
  }

  function redraw(): void {
    if (!dirty) return;
    dirty = false;

    if (degraded) {
      // Just let lines flow — don't cursor-up
      const maxTitleLen = getMaxTitleLen();
      const cap = getCapN();
      const visibleRows = rows.slice(0, cap);
      const overflow = totalJobs - cap;
      const lines: string[] = [
        renderHeader(goal, levelIndex, totalLevels, levelStartMs, out.columns ?? 80),
        '',
        ...visibleRows.map(r => renderRow(r, maxTitleLen)),
      ];
      if (overflow > 0) lines.push(`${C_DIM}  …and ${overflow} more${C_RESET}`);
      lines.push(renderFooter(rows));
      out.write(lines.join('\n') + '\n');
      return;
    }

    // Hide cursor, move up, reprint
    out.write('\x1b[?25l');
    out.write(`\x1b[${lineCount}A`);

    const cols = out.columns ?? 80;
    const maxTitleLen = getMaxTitleLen();
    const cap = getCapN();
    const visibleRows = rows.slice(0, cap);
    const overflow = totalJobs - cap;

    const lines: string[] = [
      renderHeader(goal, levelIndex, totalLevels, levelStartMs, cols),
      '',
      ...visibleRows.map(r => renderRow(r, maxTitleLen)),
    ];
    if (overflow > 0) lines.push(`${C_DIM}  …and ${overflow} more${C_RESET}`);
    lines.push(renderFooter(rows));

    out.write(lines.map(l => `\r\x1b[K${l}`).join('\n') + '\n');
    lineCount = 2 + 1 + visibleRows.length + (overflow > 0 ? 1 : 0) + 1;

    out.write('\x1b[?25h');
  }

  function tick(): void {
    // Always dirty if any job is running (elapsed time changes)
    if (rows.some(r => r.state === 'running')) dirty = true;
    if (dirty) redraw();
  }

  return {
    emit(event: ProgressEvent): void {
      switch (event.type) {
        case 'level_start': {
          levelIndex = event.levelIndex;
          totalLevels = event.totalLevels;
          levelStartMs = Date.now();
          totalJobs = event.jobs.length;
          capN = getCapN();
          rows = event.jobs.map(j => ({ id: j.id, title: j.title, state: 'pending' as RowState }));

          // Print initial panel
          out.write('\x1b[?25l');
          printPanel();
          out.write('\x1b[?25h');

          // Start tick interval
          if (ticker) clearInterval(ticker);
          ticker = setInterval(tick, tickMs);
          break;
        }
        case 'job_start': {
          const row = rows.find(r => r.id === event.jobId);
          if (row) {
            row.state = 'running';
            row.startMs = Date.now();
            dirty = true;
          }
          break;
        }
        case 'job_complete': {
          const row = rows.find(r => r.id === event.jobId);
          if (row) {
            row.state = 'done';
            row.durationMs = event.durationMs;
            dirty = true;
          }
          break;
        }
        case 'job_failed': {
          const row = rows.find(r => r.id === event.jobId);
          if (row) {
            row.state = 'failed';
            row.durationMs = event.durationMs;
            row.error = event.error;
            dirty = true;
          }
          break;
        }
        case 'job_skipped': {
          const row = rows.find(r => r.id === event.jobId);
          if (row) {
            row.state = 'skipped';
            dirty = true;
          }
          break;
        }
        case 'level_complete': {
          if (ticker) clearInterval(ticker);
          ticker = undefined;
          // Force final redraw
          dirty = true;
          redraw();
          out.write('\n');
          break;
        }
        case 'done': {
          const n = rows.filter(r => r.state === 'done').length;
          const total = formatMs(event.totalDurationMs);
          out.write(`Phase2S Conductor — done  ${n} tasks succeeded · ${total} total\n`);
          break;
        }
      }
    },
    dispose(): void {
      if (ticker) {
        clearInterval(ticker);
        ticker = undefined;
      }
      // Remove resize listener to prevent accumulation on repeated calls.
      process.stdout.removeListener('resize', onResize);
      try {
        // Clear panel + restore cursor
        if (lineCount > 0 && !degraded) {
          out.write(`\x1b[${lineCount}A`);
          for (let i = 0; i < lineCount; i++) {
            out.write('\r\x1b[K\n');
          }
          out.write(`\x1b[${lineCount}A`);
        }
        out.write('\x1b[?25h');
      } catch {
        // swallow
      }
      // Mark running rows as interrupted
      for (const row of rows) {
        if (row.state === 'running') {
          row.state = 'failed';
          row.error = 'interrupted';
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createProgressRenderer(opts: {
  mode: 'ansi' | 'plain' | 'quiet';
  goal: string;
  out?: NodeJS.WriteStream;
}): ProgressRenderer {
  const out = opts.out ?? process.stdout as NodeJS.WriteStream;

  switch (opts.mode) {
    case 'quiet':
      return createQuietRenderer();
    case 'plain':
      return createPlainRenderer(out);
    case 'ansi':
      return createAnsiRenderer(opts.goal, out);
  }
}
