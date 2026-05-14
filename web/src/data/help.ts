/**
 * Help page data — commands, dashboard sections, and keyboard shortcuts.
 * Rendered by HelpPage.tsx. Keep this file as the single source of truth
 * for command reference so the component stays a pure renderer.
 */

export interface CommandEntry {
  command: string;
  description: string;
  example: string;
}

export interface ShortcutEntry {
  keys: string;
  action: string;
}

export const COMMANDS: CommandEntry[] = [
  {
    command: "phase2s conduct <spec>",
    description: "Run a goal specification through the AI conductor.",
    example: "phase2s conduct ./my-spec.md",
  },
  {
    command: "phase2s serve",
    description: "Start the web dashboard on http://localhost:3010.",
    example: "phase2s serve",
  },
  {
    command: "phase2s lint <spec>",
    description: "Validate a spec file for required sections and quality.",
    example: "phase2s lint ./my-spec.md",
  },
  {
    command: "phase2s template",
    description: "List, create, or use spec templates (auth, bug, refactor…).",
    example: "phase2s template list",
  },
  {
    command: "phase2s conduct-log",
    description: "Show recent conduct run history from the local log.",
    example: "phase2s conduct-log --limit 20",
  },
  {
    command: "phase2s version",
    description: "Print the installed phase2s version.",
    example: "phase2s version",
  },
];

export const SHORTCUTS: ShortcutEntry[] = [
  { keys: "?", action: "Open help" },
  { keys: "g r", action: "Go to Runs page" },
  { keys: "g c", action: "Go to Config page" },
  { keys: "n", action: "New run" },
  { keys: "Escape", action: "Close modal / dismiss banner" },
];

export const DASHBOARD_SECTIONS = [
  {
    name: "Runs",
    description:
      "Browse all past and active conductor runs. Filter by goal text, status, or date range. Click any row to view the full run log and spec.",
  },
  {
    name: "Live view",
    description:
      "When a run is active, its detail page streams events in real time via SSE. The LIVE badge pulses on any active row in the runs list.",
  },
  {
    name: "New Run",
    description:
      "Start a conductor run directly from the browser. Enter a goal, choose a template (optional), pick a model tier, and submit. The browser redirects to the live view automatically.",
  },
  {
    name: "Config",
    description:
      "View and update your .phase2s.yaml settings: API keys (masked), default model, parallel mode, and other conductor options.",
  },
];
