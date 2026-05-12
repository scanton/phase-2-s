# Web Dashboard

`phase2s serve` opens a local browser UI that lets you browse your conduct run history, inspect individual runs, and quickly re-run past goals. It's a companion to `phase2s runs` (the CLI table view) — built for when you want to dig into a run visually rather than parse terminal output.

The dashboard is served entirely from `localhost` — nothing leaves your machine.

---

## Starting the dashboard

```bash
# Start on the default port (3010)
phase2s serve

# Pick a different port
phase2s serve --port 3011

# Open the browser automatically
phase2s serve --open

# Point at a project in a different directory
phase2s serve --cwd /path/to/other-project
```

The server starts, prints `Phase2S Dashboard running at http://localhost:3010`, and stays alive until you press Ctrl+C.

```
Phase2S Dashboard running at http://localhost:3010
Serving data from: /Users/you/your-project
```

---

## The Runs list page

The landing page (`/`) shows every past `phase2s conduct` run, newest first.

**Summary bar** at the top:
- Total runs
- Last run timestamp
- Average duration

**Run table** — one row per run:

| Column | What it shows |
|--------|--------------|
| Goal | Truncated goal text with full text on hover |
| Status | ✓ pass / ✗ fail badge pill |
| Duration | Wall-clock time (e.g. `1m 23s`) |
| Subtasks | Number of sub-tasks in the run |
| When | Relative timestamp (e.g. "3 hours ago") |

Click any row to open the Run detail page for that run.

**Empty state** — if you haven't run `phase2s conduct` yet, the page shows a welcome message with the command to run.

**Error state** — if the API fails (project directory not found, corrupt log, etc.) an error banner appears at the top.

---

## The Run detail page

Click any row from the Runs list to open `/runs/:id`. Shows everything about a single run.

**Header card:**
- Large pass/fail badge
- Full goal text (untruncated)
- 4px colored left border: green for pass, red for fail
- Stats row: duration, subtask count, round count, date, dry-run label (if applicable)

**Spec accordion** (collapsed by default):
- Click to expand and read the full spec markdown that `phase2s conduct` generated for this run
- Rendered as styled markdown (not raw text)
- Scroll within the accordion if the spec is long

**Subtasks table:**
- One row per worker event from the run log
- Columns: #, Name, Status (pass/fail/running), Duration
- Empty state if no subtask events are in the run log

**Re-run hint** at the bottom:
```
phase2s conduct "your original goal text here"
```
Click the code block to select all (via `user-select: all`), then copy-paste directly into your terminal.

---

## REST API

The dashboard is backed by three endpoints. You can call them directly if you want to script against your run history.

**`GET /api/runs`**

Returns all conduct-log entries, newest first.

```bash
curl http://localhost:3010/api/runs | jq '.[0]'
```

```json
{
  "ts": "2026-05-11T12:34:56.000Z",
  "goal": "add rate limiting to the API",
  "specHash": "abc12345",
  "specPath": ".phase2s/specs/2026-05-11-rate-limiting.md",
  "subtaskCount": 3,
  "roles": ["AuthMiddleware", "RateLimiter", "Tests"],
  "success": true,
  "durationMs": 83400,
  "rounds": 1,
  "dryRun": false
}
```

**`GET /api/runs/:id`**

Returns a single run by `specHash`. Includes the entry from `conduct-log.jsonl`, the full spec file content, and the run log events.

```bash
curl http://localhost:3010/api/runs/abc12345 | jq '.spec' | head -5
```

Response shape:
```json
{
  "entry": { ... },
  "spec": "# Add rate limiting\n\n...",
  "runLog": [
    { "event": "worker_completed", "name": "AuthMiddleware", "status": "success", "durationMs": 8200 },
    ...
  ]
}
```

**`GET /api/spec?path=<absolute-path>`**

Reads a spec file at the given absolute path. Path traversal guarded — the resolved path must be inside the project directory (`cwd`). Returns the raw markdown as `text/markdown`.

```bash
curl "http://localhost:3010/api/spec?path=$(pwd)/.phase2s/specs/2026-05-11-rate-limiting.md"
```

Error responses: `400` (missing `path`), `403` (path traversal blocked), `404` (file not found).

---

## Security

The server binds to `127.0.0.1` only — it is not accessible to other machines on your local network. There is no authentication because the data (your conduct log and spec files) is only accessible locally.

**Path traversal guard:** All file-read endpoints resolve the requested path with `fs.realpath()` (symlink-safe) and verify it starts with your project's `cwd` before reading. Requests for files outside the project directory return `403 Access denied`.

**`--cwd` validation:** The server validates that a `.phase2s/` directory exists in the `cwd` before starting. Running `phase2s serve --cwd /` or another non-project directory exits with an error rather than silently serving the filesystem.

**Spec content sanitization:** Spec markdown is rendered in the browser with `rehype-sanitize` — unsafe HTML attributes (`onerror`, `javascript:` hrefs, etc.) are stripped before rendering.

---

## Architecture

The dashboard is a pre-built React + Vite SPA shipped inside the `@scanton/phase2s` npm package. When you run `phase2s serve`, it starts an Express HTTP server that:

1. Serves the pre-built SPA from `dist/web/` (bundled into the npm package)
2. Exposes the REST API endpoints backed by your local `conduct-log.jsonl`
3. Serves `index.html` for all non-API routes (SPA fallback)

The frontend uses React Router (HashRouter) and is styled with Tailwind CSS using the design system defined in `DESIGN.md` — Geist/Geist Mono fonts, zinc-900 dark palette, indigo-500 accent.

**Stack:**
- Server: Express on Node.js
- Frontend: React 18 + Vite + React Router + Tailwind CSS
- Fonts: `@fontsource/geist` + `@fontsource/geist-mono` (no CDN)
- Markdown: `react-markdown` + `rehype-sanitize`

---

## What's coming

Sprint 94 ships the foundation: the runs browser and run detail view. Future sprints will add:

- **Live view** — watch a `phase2s conduct` run in real time as subtasks complete
- **Config** — view and edit your `.phase2s.yaml` in the browser
- **Help** — in-browser skill reference
- **Light mode** — theme toggle (CSS variable system is already in place)
- **Mobile viewport** — responsive layout for phones/tablets
