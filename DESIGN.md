# Phase2S Web Dashboard — Design System

Created: 2026-05-11 (Sprint 94, /plan-design-review)
Reviewed by: /plan-design-review skill
Status: LOCKED for Sprint 94. Revisit before Sprint 95 with /plan-design-review.

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

### Base palette (dark mode only for Sprint 94)

```css
/* web/src/index.css */
:root {
  --bg-base: theme('colors.zinc.900');       /* #18181b — page background */
  --bg-surface: theme('colors.zinc.800');    /* #27272a — cards, panels */
  --bg-subtle: theme('colors.zinc.700');     /* #3f3f46 — hover states */
  --border: theme('colors.zinc.700');        /* dividers */
  --text-primary: theme('colors.zinc.100');  /* #f4f4f5 — headings, labels */
  --text-secondary: theme('colors.zinc.400'); /* #a1a1aa — secondary info */
  --text-muted: theme('colors.zinc.500');    /* coming-soon sidebar items */

  /* Accent */
  --accent: theme('colors.indigo.500');      /* #6366f1 — active nav, links, focus rings */
  --accent-hover: theme('colors.indigo.400');

  /* Status */
  --status-success: theme('colors.emerald.500'); /* #10b981 */
  --status-failed: theme('colors.red.500');      /* #ef4444 */
  --status-running: theme('colors.amber.400');   /* #fbbf24 */
}
```

---

## Status Badges

Pill component: `<StatusBadge status="success|failed|running" />`

- **Shape:** Rounded-full pill, `px-2 py-0.5`, `text-xs font-medium`
- **Content:** Icon (✓ / × / ● pulse) + space + text ("success" / "failed" / "running")
- **Background:** 15% opacity of the status color (e.g. `bg-emerald-500/15`)
- **Text/border:** Full status color (e.g. `text-emerald-400`)
- **Running pulse:** CSS `animate-pulse` on the ● dot only, not the whole badge

---

## Navigation Sidebar

- **Width:** 220px (desktop), 48px icon-only (tablet 768-1024px)
- **Brand:** "Phase2S" text at top, `font-mono text-sm text-zinc-100`
- **Active item:** `bg-indigo-500/10 text-indigo-400 border-l-2 border-indigo-500`
- **Inactive item:** `text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800`
- **Coming soon items:** `opacity-40 cursor-default` + tooltip: "Coming in Sprint 95"

---

## Runs Table

- **Row hover:** `hover:bg-zinc-800 cursor-pointer` (subtle background shift)
- **Goal cell:** `font-mono text-sm truncate max-w-[320px]` + `title` attribute for native tooltip (full goal text on hover)
- **Status column:** `<StatusBadge>` component
- **Duration/Subtasks/Timestamp:** `font-mono text-xs text-zinc-400`
- **Timestamp:** relative format ("2 hours ago") via a date-fns or similar helper
- **Table skeleton (loading):** 5 rows of `animate-pulse` gray bars matching column widths
- **Error banner:** amber/red top border, `bg-amber-950/30 text-amber-300 px-4 py-2` with retry link

---

## Summary Stat Bar (above Runs table)

One-line bar above the table:
```
N runs  ·  last run X ago  ·  avg Xm Xs
```
- `text-xs font-mono text-zinc-400`
- `mb-4 pb-3 border-b border-zinc-700`

---

## Empty State

```
No runs yet.
Start one: phase2s conduct "<goal>"
───────────────────────────────
[copyable code block with: phase2s conduct "add auth"]
```
- Heading: `text-zinc-400 text-sm`
- Subtext: `text-zinc-500 text-xs`
- Code block: `bg-zinc-800 font-mono text-sm px-3 py-2 rounded-md` with copy-to-clipboard button

---

## Run Detail Page

- **Back nav:** `← Runs` link above heading — `text-zinc-400 text-xs hover:text-zinc-100`
- **Status stripe:** 4px left border on the detail panel taking the status color (`border-l-4 border-emerald-500`)
- **Status badge:** large version of `<StatusBadge>` inline with goal heading
- **Spec accordion:** collapsed by default, `▸ Spec` header with `▾` when expanded
  - Spec content in `font-mono text-sm` inside a `bg-zinc-800 rounded-md p-4` panel
- **Re-run hint:** `phase2s conduct "<goal>"` in a copyable code block at the bottom
- **Subtasks table:** same table design as runs table, columns: Role, Title, Status, Duration

---

## Responsive

| Viewport | Sidebar | Content |
|----------|---------|---------|
| ≥1024px desktop | 220px full labels | Full table |
| 768-1024px tablet | 48px icon-only | Full table |
| <768px | N/A (not in scope for Sprint 94) | N/A |

---

## Accessibility (WCAG 2.1 AA essentials)

- `<a href="#main">Skip to content</a>` as first element in `<body>`
- Runs table: `<table>` with `<th scope="col">` and `<caption>` for screen readers
- Clickable rows: `<tr role="button" tabIndex={0} onKeyDown={handleEnter}>` — keyboard navigable
- Icon-only buttons (copy, close): `aria-label` required
- Focus ring: `focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-zinc-900`
- Color is never the ONLY status indicator (icon + text + color in status badges)

---

## Not in scope for Sprint 94

- Light mode / theme toggle (Sprint 95+)
- Phone/mobile viewport (<768px)
- Full screen reader audit (Sprint 95)
- Motion/animation preferences (`prefers-reduced-motion`) — add in Sprint 95
- Design tokens as a separate file/package
