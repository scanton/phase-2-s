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

## Live view

When `phase2s conduct` is running, the dashboard detects it automatically and shows the run in real time.

### How it works

`RunLogger` writes each event to disk the moment it happens (`appendFileSync`). The HTTP server tails the JSONL file via SSE (Server-Sent Events) — no WebSockets, no changes to the conductor process, no shared state. The filesystem is the message bus.

### What you see

**Runs list page** — active runs show a pulsing **LIVE ●** badge in indigo instead of a pass/fail badge. The row has a subtle indigo tint. Click it to open the live detail view.

**Sidebar** — the "Live" nav item lights up when at least one run is active. Click it to jump directly to the active run's detail page.

**Run detail page** — while a run is in progress:
- The header badge shows **LIVE ●** instead of pass/fail
- The status stripe is indigo
- An **elapsed timer** (Geist Mono, updates every second) replaces the duration stat
- Subtask rows appear as each worker completes — you watch the table fill in
- In-progress workers show with a "running" badge until they complete
- A "watching…" indicator appears while waiting for the first event

When the run finishes, the LIVE badge transitions to the final pass/fail badge, the timer stops, and the stats update to reflect the completed run.

### Browser notifications

The first time you open a live run detail page, a toast prompt appears asking if you want desktop notifications. If you allow it:
- A notification fires when the run completes: `Phase2S: ✓ your goal text` (or `✗` on failure)
- Your preference is remembered for the session

### Tab title

While watching a live run, the browser tab title updates to show progress:
```
↺ 3/5 — Phase2S
```
This means 3 of 5 subtasks have completed. You can close the tab or switch away and still know when to check back.

---

## REST API

The dashboard is backed by nine endpoints. You can call them directly if you want to script against your run history.

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

**`GET /api/runs/active`**

Returns runs that are currently in progress. A run is "active" if its JSONL log file was modified within the last 30 minutes and does not yet contain a terminal event.

```bash
curl http://localhost:3010/api/runs/active
```

```json
{
  "runs": [
    { "specHash": "ab12cd34", "startedAt": "2026-05-11T14:22:10", "runLogPath": "/path/to/.phase2s/runs/..." }
  ]
}
```

Returns `{ "runs": [] }` when no active runs exist.

**`GET /api/runs/:id`**

Returns a single run by `specHash`. Includes the entry from `conduct-log.jsonl`, the full spec file content, the run log events, and an `isActive` flag. For runs that are still in progress (not yet in the conduct log), a synthetic entry is built from the run log.

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
  ],
  "isActive": false
}
```

**`GET /api/runs/:id/stream`**

Server-Sent Events endpoint that tails a run's JSONL file. Replays all existing events on connect (catch-up), then streams new events as they are written. Sends `event: close` when a terminal event is detected.

```bash
curl -N http://localhost:3010/api/runs/abc12345/stream
```

```
data: {"event":"goal_started","specHash":"abc12345",...}
data: {"event":"worker_completed","index":0,"status":"passed","durationMs":8200}
event: close
data: {}
```

**`POST /api/runs`**

Spawns a new `phase2s conduct` run from the browser. Validates the goal, runs the authoritative lint gate, spawns the conduct process, and returns a ts-slug `id` immediately. The browser redirects to `/runs/:id` to watch the live stream.

```bash
curl -X POST http://localhost:3010/api/runs \
  -H "Content-Type: application/json" \
  -d '{"goal":"add rate limiting to the API","modelTier":"smart","parallel":false}'
```

Request body:
```json
{
  "goal": "add rate limiting to the API",
  "template": "api",
  "modelTier": "fast" | "smart",
  "parallel": false
}
```

`template` is optional. When provided, must be one of `auth`, `api`, `bug`, `refactor`, `test`, `cli`. `modelTier` defaults to `"smart"`. `parallel` defaults to `false`.

Response (`200`):
```json
{ "id": "2026-05-12T22-34-57-000" }
```

Error responses: `400` (missing/invalid `goal`, invalid `template`), `429` (10+ runs already in progress), `500`.

---

**`POST /api/lint`**

Advisory lint: writes a temporary spec from the goal text and runs `phase2s lint` on it. Used by the browser "Check Goal" button before run submission. Does not modify any project files.

```bash
curl -X POST http://localhost:3010/api/lint \
  -H "Content-Type: application/json" \
  -d '{"goal":"add rate limiting to the API"}'
```

Response:
```json
{ "valid": true, "errors": [] }
```

On lint failure:
```json
{ "valid": false, "errors": ["Goal section is too short", "Missing success criteria"] }
```

---

**`GET /api/spec?path=<absolute-path>`**

Reads a spec file at the given absolute path. Path traversal guarded — the resolved path must be inside the project directory (`cwd`). Returns the raw markdown as `text/markdown`.

```bash
curl "http://localhost:3010/api/spec?path=$(pwd)/.phase2s/specs/2026-05-11-rate-limiting.md"
```

Error responses: `400` (missing `path`), `403` (path traversal blocked), `404` (file not found).

**`GET /api/config`**

Reads `.phase2s.yaml` (or `.phase2s.yml`) from the project directory. Sensitive fields (API keys, webhook URLs) are masked as `"***SET***"` — the actual values are never sent to the browser. Returns `404` when no config file exists, `500` when the YAML is malformed.

```bash
curl http://localhost:3010/api/config | jq '.config.provider'
```

**`POST /api/config`**

Writes changes back to `.phase2s.yaml`. Merges the request body over the existing file at the section level.

Sentinel rules:
- Field value `"***SET***"` → preserve existing value (do not overwrite)
- Field value `""` (empty string) → delete the key from YAML
- Any other value → overwrite with new value

```bash
curl -X POST http://localhost:3010/api/config \
  -H "Content-Type: application/json" \
  -d '{"provider":"anthropic","model":"claude-opus-4"}'
```

Error responses: `400` (invalid payload or Zod validation failure), `500` (YAML syntax error or write failure).

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
- Icons: `@heroicons/react` (theme toggle, sidebar nav)
- Markdown: `react-markdown` + `rehype-sanitize`
- Tests: Vitest + jsdom + `@testing-library/react` + `vitest-axe`

---

## Theme toggle

The sidebar bottom control cycles through three theme states: **light**, **system** (follows OS preference), and **dark**. First visit defaults to system. Your choice is saved in `localStorage` under the key `phase2s-theme`. In system mode, the dashboard listens for `prefers-color-scheme` changes so it updates when you switch your OS between light and dark.

Icons use `@heroicons/react`: SunIcon (light), ComputerDesktopIcon (system), MoonIcon (dark).

---

## Responsive layout

The sidebar adapts to viewport width automatically — no configuration needed.

| Viewport | Sidebar behavior |
|----------|-----------------|
| **Desktop** (≥1024px) | Full 220px sidebar with labels and brand |
| **Tablet** (768–1023px) | Collapsed to 48px, icon-only, labels hidden |
| **Mobile** (<768px) | Hidden off-screen; hamburger button appears in the main content area, slides sidebar open as an overlay with a semi-transparent backdrop |

The hamburger button has `aria-expanded` set correctly so screen readers announce the open/close state.

---

## Accessibility

The dashboard targets WCAG 2.1 AA. Sprint 96 additions:

- **Keyboard navigation** — table rows have `tabIndex={0}` and respond to Enter/Space for navigation (same as click)
- **`aria-busy`** — the `<table>` element has `aria-busy={loading}` during load so assistive tech knows content is loading
- **`scope="col"` on headers** — all `<th>` elements in RunsPage and the subtasks table carry `scope="col"`
- **Focus rings** — `:focus-visible` shows a 2px indigo outline globally
- **`prefers-reduced-motion`** — all keyframe animations (`pulse`, `live-pulse`, `banner-slide-in`) and timer ticks are disabled when the OS motion preference is `reduce`
- **Skip link** — the existing skip link has `z-index: 200` to clear the sidebar overlay on mobile
- **`CompletionBanner`** — uses `role="status" aria-live="polite"` so screen readers announce run completion; keyboard-focusable and dismissible with Enter or Space

An `axe-core` smoke test runs as part of `npm run test:web` to gate accessibility regressions in CI.

---

## Config page (Sprint 97)

The **Config** nav item in the sidebar opens `/config`, a form for viewing and editing your `.phase2s.yaml`.

### How it works

The page fetches `GET /api/config` on load. Sensitive fields (API keys, webhook URLs) are shown as masked — their placeholder text reads "(currently set)" and you can toggle visibility with the eye icon.

**5 sections:**
1. **Provider & Model** — select your AI provider and set model overrides
2. **API Keys** — OpenAI, Anthropic, OpenRouter, Gemini, MiniMax (all password fields)
3. **Ollama** — base URL and embed model (de-emphasized when provider is not `ollama`)
4. **Notifications** — macOS system notifications, Slack, Discord, Teams, Telegram
5. **Behavior** — allowDestructive, requireSpecification, verifyCommand, browser tool

### Sentinel pattern (key safety)

API key fields loaded from the server carry a `hasExisting` flag. When you save without touching a password field, the client sends `"***SET***"` — the server sees this and preserves the existing value instead of overwriting or deleting it. Clearing a password field and saving deletes the key.

### Save flow

- The **Save changes** button is disabled until you make an edit (dirty tracking)
- `allowDestructive: false → true` shows a confirmation dialog before changing
- On success, a "Config saved" toast appears and auto-dismisses after 3 seconds
- On error, an inline error message appears below the toast area

---

## New Run page (Sprint 98)

Click **New Run** in the sidebar (or go to `/new`) to launch a conduct run directly from the browser — no terminal required.

### Form fields

| Field | What it does |
|-------|-------------|
| **Goal** | Describe what you want built. Supports up to 2000 characters. |
| **Template** | Optional starting point. Choose from `auth`, `api`, `bug`, `refactor`, `test`, or `cli`. Leaves the spec more detailed than a freeform goal. |
| **Model tier** | **Fast** uses the fast model (lower latency, lower cost). **Smart** uses the full model (default). |
| **Parallel** | When checked, passes `--parallel` to conduct so independent subtasks run concurrently in git worktrees. |

### Lint check

Click **Check Goal** before submitting to run `phase2s lint` on your goal text. Any issues appear inline — a "Looks good" badge means the lint gate will pass. The Run button stays enabled regardless so you can still submit and see the full server-side error.

### What happens on submit

1. The browser sends `POST /api/runs` with your goal, template, model tier, and parallel flag.
2. The server writes a spec file, runs the authoritative lint gate, and spawns `phase2s conduct` as a child process.
3. You're redirected to `/runs/:id` immediately — the live view starts streaming as conduct runs.

If the server returns an error (lint failure, concurrency limit), it appears as an error banner above the form.

---

## Completion banner

When a live run finishes, a **CompletionBanner** slides in from the top of the run detail page. It auto-dismisses after 3 seconds. You can dismiss it early by clicking or pressing Enter/Space. Uses `banner-slide-in` CSS animation (disabled when `prefers-reduced-motion: reduce`).

---

## Testing the web UI

```bash
# Run web component tests (jsdom + vitest-axe)
npm run test:web

# Run all tests (node + web)
npm run test:all
```

`npm run test:web` is an alias for `cd web && npm run test:web`, which runs Vitest with the `web/vitest.config.ts` config (jsdom environment, React plugin, axe matchers). These are separate from the root Node.js unit tests.

---

## Filter toolbar (Sprint 99)

The Runs list page has a filter toolbar directly above the table.

### Controls

| Control | What it does |
|---------|-------------|
| **Search** | Case-insensitive substring match against the run goal. 300ms debounce; in-flight requests cancelled via `AbortController`. |
| **Status** | All / Success / Failure / Active / Unknown. Success and Failure filter server-side via `?status=`; Active and Unknown are applied client-side against the live active-run poll set. |
| **From / To** | Date-range filter. Sends `?after=` / `?before=` ISO 8601 timestamps to the server. |
| **Clear filters** | Appears when any filter is active. Resets all controls and clears URL params. |

### URL state

Filter state syncs to the URL via `useSearchParams` with `replace: true`, so the back button never cycles through intermediate filter states. A bookmarked URL with `?search=auth&status=success` opens the Runs page with those filters pre-applied.

### Empty states

- **"No runs yet"** — the conduct log is empty (no filters active).
- **"No runs match your filters"** — filters are active but nothing matches. Includes a "Clear filters" link.

---

## Project grouping (Sprint 99)

When runs from two or more different git projects appear in the conduct log (e.g. you've used `phase2s serve --cwd` or have runs from different machines merged into one log), the Runs page groups entries by project root.

The project root is derived from the `specPath` field in each log entry — walking up to the directory that contains `.phase2s/`. Single-project users see the flat list as before; no toggle needed.

---

## Help page (Sprint 99)

Click **Help** in the sidebar (or navigate to `/help`) to open the in-browser reference.

Four sections:

| Section | What it shows |
|---------|--------------|
| **Getting Started** | Three-step onboarding: install, configure, run |
| **Commands** | Table of `phase2s` CLI commands with descriptions and example flags |
| **Dashboard** | What each page of the dashboard does |
| **Keyboard Shortcuts** | All supported keyboard shortcuts (table rows, sidebar toggle, etc.) |

The data lives in `web/src/data/help.ts` — a typed array of section objects. Add new entries there without touching the component.

---

## What's coming

The v2.0 milestone is complete — all features promised in the original web dashboard plan (Sprint 94) have shipped. Future work is tracked in `TODOS.md`.
