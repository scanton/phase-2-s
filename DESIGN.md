# Phase2S Web Dashboard — Design System

Created: 2026-05-11 (Sprint 94, /plan-design-review)
Reviewed by: /plan-design-review skill
Updated: 2026-05-12 (Sprint 96 — Polish Pass + Accessibility)
Status: CURRENT

---

## Classifier

**APP UI** — local developer tool, task-focused, data-dense, not marketing.

---

## Typography

| Role | Font | Tailwind class |
|------|------|---------------|
| UI text (nav, labels, headings) | Geist | `font-sans` (set Geist as sans) |
| Code/data (goals, timestamps, durations, hash IDs, spec content) | Geist Mono | `font-mono` |

Load via: `@fontsource/geist` + `@fontsource/geist-mono` (npm packages, zero CDN dependency)

Body text minimum size: 14px. NEVER below 12px. Contrast ratio ≥ 4.5:1 on body text.

---

## Color System

### Full CSS variable palette (dark + light)

```css
/* web/src/index.css */
:root {
  --bg-base: theme('colors.zinc.900');            /* #18181b — page background */
  --bg-surface: theme('colors.zinc.800');         /* #27272a — cards, panels, sidebar */
  --bg-subtle: theme('colors.zinc.700');          /* #3f3f46 — hover states */
  --border: theme('colors.zinc.700');             /* #3f3f46 — dividers */
  --text-primary: theme('colors.zinc.100');       /* #f4f4f5 — headings, labels */
  --text-secondary: theme('colors.zinc.400');     /* #a1a1aa — secondary info */
  --text-muted: theme('colors.zinc.500');         /* #71717a — disabled items */

  --accent: theme('colors.indigo.500');           /* #6366f1 — active nav, focus rings */
  --accent-hover: theme('colors.indigo.400');     /* #818cf8 — hover state */
  --accent-dim: rgba(99,102,241,0.1);             /* nav active bg */
  --accent-dim-hover: rgba(99,102,241,0.15);      /* nav active hover bg */

  --status-success-text: theme('colors.emerald.400');  /* #34d399 */
  --status-success-bg: rgba(16,185,129,0.15);
  --status-failed-text: theme('colors.red.400');       /* #f87171 */
  --status-failed-bg: rgba(239,68,68,0.15);
  --status-running-text: theme('colors.amber.400');    /* #fbbf24 */
  --status-running-bg: rgba(251,191,36,0.15);

  --live-color: theme('colors.indigo.400');       /* #818cf8 — LIVE badge, pulse dot */
  --live-bg: rgba(99,102,241,0.1);
  --live-row-bg: rgba(99,102,241,0.04);
  --live-row-bg-hover: rgba(99,102,241,0.08);
}

[data-theme="light"] {
  --bg-base: theme('colors.zinc.50');             /* #fafafa */
  --bg-surface: theme('colors.zinc.100');         /* #f4f4f5 */
  --bg-subtle: theme('colors.zinc.200');          /* #e4e4e7 */
  --border: theme('colors.zinc.200');             /* #e4e4e7 */
  --text-primary: theme('colors.zinc.900');       /* #18181b */
  --text-secondary: theme('colors.zinc.600');     /* #52525b */
  --text-muted: theme('colors.zinc.500');         /* #71717a */

  --accent: theme('colors.indigo.600');           /* #4f46e5 */
  --accent-hover: theme('colors.indigo.500');     /* #6366f1 */
  --accent-dim: rgba(79,70,229,0.1);
  --accent-dim-hover: rgba(79,70,229,0.15);

  --status-success-text: theme('colors.emerald.700');
  --status-success-bg: rgba(5,150,105,0.12);
  --status-failed-text: theme('colors.red.700');
  --status-failed-bg: rgba(220,38,38,0.12);
  --status-running-text: theme('colors.amber.700');
  --status-running-bg: rgba(217,119,6,0.12);

  --live-color: theme('colors.indigo.600');
  --live-bg: rgba(79,70,229,0.1);
  --live-row-bg: rgba(79,70,229,0.04);
  --live-row-bg-hover: rgba(79,70,229,0.08);
}
```

**Rule:** All component styles must use CSS variables. No hardcoded hex colors.

---

## Focus rings

All interactive elements receive a focus ring via `:focus-visible`:

```css
:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

Never use `:focus` alone — only `:focus-visible` to avoid showing rings on mouse clicks.

---

## Theme toggle

Three-state control at the bottom of the sidebar: **light / system / dark**.

- First visit: defaults to `system` (follows OS preference)
- `localStorage` key: `phase2s-theme` (absent = system mode)
- Clicking cycles through `light → system → dark → light`
- Icons from `@heroicons/react/24/outline`: `SunIcon`, `ComputerDesktopIcon`, `MoonIcon`
- In `system` mode, listens for `prefers-color-scheme` change events and applies the resolved theme immediately

---

## Status Badges

Pill component: `<StatusBadge status="success|failed|running" />`

- **Shape:** Rounded-full pill, `px-2 py-0.5`, `text-xs font-medium`
- **Content:** Icon (✓ / × / ● pulse) + space + text ("success" / "failed" / "running")
- **Background:** `var(--status-{status}-bg)` — 15% opacity
- **Text:** `var(--status-{status}-text)` — full status color
- **Running pulse:** CSS `animate-pulse` on the ● dot only, not the whole badge

---

## Navigation Sidebar

- **Desktop (≥1024px):** 220px, shows text labels (icons hidden via `.sidebar-icon { display: none }`)
- **Tablet (768–1023px):** 48px icon-only (`.sidebar-label { display: none }`)
- **Mobile (<768px):** slides in from left as overlay; hamburger button in main content area top-left

Icons from `@heroicons/react/24/outline`:
- Runs → `TableCellsIcon`
- Live → `SignalIcon`
- Config → `Cog6ToothIcon`
- Help → `QuestionMarkCircleIcon`
- Theme toggle → `SunIcon` / `ComputerDesktopIcon` / `MoonIcon`

Sidebar state:
- **Active item:** `background: var(--accent-dim); color: var(--accent-hover); border-left: 2px solid var(--accent)`
- **Inactive item:** `color: var(--text-secondary); hover: var(--bg-subtle)`
- **Coming soon items:** `opacity: 0.4; cursor: default`

---

## Tablet sidebar

At 768–1023px the sidebar collapses to 48px. Labels are hidden, icons are shown. The brand name is also hidden. Each nav item shows only its icon, centered.

---

## Mobile sidebar

At <768px the sidebar is hidden off-screen (`left: -220px`). A hamburger button (36×36px, `border: 1px solid var(--border)`, border-radius 6px) appears in the top-left of the main content area. Clicking it opens the sidebar overlay (`left: 0`, z-index 50). A semi-transparent backdrop (z-index 40) dismisses it on click. When open, the sidebar shows full labels (same as desktop layout).

---

## Runs Table

- **Row hover:** background shifts to `var(--bg-subtle)` (non-live rows) or `var(--live-row-bg-hover)` (live rows)
- **Goal cell:** `font-mono text-sm truncate max-w-[320px]` + `title` attribute for native tooltip
- **Status column:** `<StatusBadge>` component
- **Duration/Subtasks/Timestamp:** `font-mono text-xs color: var(--text-secondary)`
- **Table skeleton (loading):** 5 rows of `animate-pulse` bars in `var(--bg-subtle)`
- **Error banner:** amber rgba with amber text
- **Keyboard nav:** `tabIndex={0}` + `onKeyDown` (Enter/Space to navigate) on all `<tr>` rows
- **aria-busy:** table wrapper div has `aria-busy={loading}` during load

---

## Summary Stat Bar (above Runs table)

- `text-xs font-mono color: var(--text-muted)` for labels
- `text-2xl font-semibold font-mono color: var(--text-primary)` for values
- Success rate color: data-driven (`#34d399` / `#fbbf24` / `#f87171` thresholds)

---

## Run Detail Page

- **Back nav:** `← Runs` link above heading
- **Status stripe:** 4px left border: `var(--accent)` while live, `var(--status-success-text)` / `var(--status-failed-text)` when complete
- **Status badge:** large version of `<StatusBadge>` inline with goal heading
- **ElapsedTimer:** "ELAPSED" label while live, "DURATION" label after completion; skips `setInterval` when `prefers-reduced-motion: reduce` or run is complete
- **Completion banner:** `<CompletionBanner>` appears on SSE stream close; slides in, auto-dismisses after 3s, clickable to dismiss early. `role="status" aria-live="polite"`
- **Notification prompt:** appears 5s after opening a live run (delayed), hidden permanently after `Notification.permission === "granted"`
- **Spec accordion:** collapsed by default, `▸ Spec` / `▾ Spec` toggle
- **Re-run hint:** `phase2s conduct "<goal>"` in a copyable code block at the bottom
- **Subtasks table:** columns: #, Name, Status, Duration

---

## Responsive

| Viewport | Sidebar | Content |
|----------|---------|---------|
| ≥1024px desktop | 220px full labels | Full table |
| 768–1023px tablet | 48px icon-only | Full table |
| <768px mobile | Hamburger overlay | Full table, hamburger button visible |

---

## Accessibility (WCAG 2.1 AA)

- `<a href="#main">Skip to content</a>` as first element in `<body>` (z-index 200 on focus)
- Runs table: `<th scope="col">` on all column headers
- Clickable rows: `tabIndex={0}` + `onKeyDown` (Enter/Space) for keyboard nav
- Icon-only buttons: `aria-label` required on all
- Focus ring: `outline: 2px solid var(--accent); outline-offset: 2px` via `:focus-visible`
- Color is never the ONLY status indicator (icon + text + color in status badges)
- `aria-busy` on table wrapper during loading state
- `aria-expanded` on hamburger button and spec accordion button
- `aria-label` on sidebar `<nav>` element
- vitest-axe CI gate: axe smoke tests for RunsPage and Sidebar

---

## prefers-reduced-motion

**CSS:** All keyframe animations (`pulse`, `live-pulse`, `banner-slide-in`) and transitions are disabled via:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

**JS:** `ElapsedTimer` skips `setInterval` when `window.matchMedia("(prefers-reduced-motion: reduce)").matches` is true. It also stops ticking after `isComplete` is set.

---

## Component inventory

| Component | File | Notes |
|-----------|------|-------|
| `App` | `web/src/App.tsx` | Layout shell, theme hook, hamburger state |
| `Sidebar` | `web/src/components/Sidebar.tsx` | Nav, active-run polling, theme toggle |
| `StatusBadge` | `web/src/components/StatusBadge.tsx` | Pass/fail/running pill |
| `CompletionBanner` | `web/src/components/CompletionBanner.tsx` | 3s auto-dismiss completion toast |
| `RunsPage` | `web/src/pages/RunsPage.tsx` | Runs list + StatBar |
| `RunDetailPage` | `web/src/pages/RunDetailPage.tsx` | Run detail, live stream, elapsed timer |
| `useTheme` | `web/src/hooks/useTheme.ts` | Three-state theme, localStorage, OS listener |
