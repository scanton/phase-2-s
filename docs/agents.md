# Agent Modes

Phase2S ships three built-in agent modes. Each has a specific job, a specific model tier, and a hard-wired tool set enforced at the registry level — not just in the system prompt.

Switch between them mid-session without losing your conversation history. The tool registry and system prompt change; everything else stays.

---

## Built-in modes

| Mode | Switch to | Model | Tools | Best for |
|------|-----------|-------|-------|----------|
| **build** | `:build` | smart | all tools | Writing code, running tests, making changes |
| **ask** | `:ask` | fast | glob, grep, file_read, browser | Questions, exploration, code review |
| **plan** | `:plan` | smart | read tools + plans_write | Design docs, architecture plans, specs |

### build — The default

Full tool access: read tools, `shell`, `file_write`, `browser`. Use build mode when you want Phase2S to actually change things.

```
you > :build
→ Switched to: build (Implement, fix, and build)

you > implement the pagination logic from plans/pagination.md
```

### ask — Read-only

Read-only. Fast model. Cannot write files, cannot run shell commands. Use ask mode for quick questions, code exploration, and anything where you want an answer without side effects.

```
you > :ask
→ Switched to: ask (Research and explain codebases)

you > how does the session locking work in session.ts?
```

The tool restriction is hard. `file_write` and `shell` are not in the registry at all — they're not hidden by a system prompt instruction that could be overridden. Ask mode literally cannot write a file even if you ask it to.

### plan — Planner

Smart model. Reads everything, writes only to `plans/`. Use plan mode to think through a design before building it. Plans go to `plans/` and are sandboxed there — plan mode cannot touch source files.

```
you > :plan
→ Switched to: plan (Create implementation plans)

you > design the rate limiting system — what are the tradeoffs between in-memory and Redis?
```

The `plans_write` tool auto-creates `plans/` if it doesn't exist, and refuses to truncate an existing plan file to empty content.

---

## Switching modes

```bash
:ask        # Switch to ask mode (read-only, fast)
:plan       # Switch to plan mode (planning, smart)
:build      # Switch to build mode (full access, smart)

:agents     # List all available agents with aliases, model, and tool count
```

Your conversation history is preserved. The tool registry and system prompt are swapped in place.

### Resume persistence

When you run `phase2s --resume`, the active mode is restored. If the saved agent no longer exists (e.g., you removed a custom agent), Phase2S falls back to build mode with a warning.

---

## Custom agents

Add a `.phase2s/agents/<name>.md` file to your project. Phase2S picks it up automatically on the next session start.

```markdown
---
id: scout
title: "Fast codebase explorer"
model: fast
tools:
  - glob
  - grep
  - file_read
aliases:
  - ":scout"
---

A fast, read-only codebase explorer. Find things quickly and explain them clearly. Never suggest changes. Always cite file paths and line numbers.
```

Switch to it with `:scout` or `:agent scout`.

### Model tiers

`model` in the frontmatter accepts:
- `fast` — maps to `fast_model` in your config (default: `gpt-4o-mini` or equivalent)
- `smart` — maps to `smart_model` in your config (default: `gpt-4o` or equivalent)
- Any literal model name — e.g., `gpt-4o`, `claude-3-5-sonnet-20241022`

---

## Override-restrict policy

You can override a built-in agent by placing a `.phase2s/agents/ask.md` (or `build.md`, `plan.md`) in your project. The override can:

- **Narrow the tool list** — give the agent fewer tools than it ships with
- **Change the system prompt** — customize behavior for your project

The override **cannot**:

- **Expand the tool list** — a project override of `ask` cannot add `shell` or `file_write`. Phase2S will warn and ignore any tools not in the built-in's list.
- **Steal a built-in alias** — a custom agent (new id) that declares `:build` as an alias will have that alias silently dropped. Built-in aliases are protected.

`tools: []` in an override is treated as explicit deny-all, not "no restriction."

### Inheritance

If your override has no `tools:` field, the built-in's tool list is inherited. This is the most common case: customize the instructions without changing what the agent can do.

```markdown
---
id: ask
title: "Project-specific researcher"
---

A read-only research assistant. When asked about this codebase, always
reference the ADR docs in docs/adr/ first. Cite specific line numbers.
```

This override inherits ask mode's tool list (`glob`, `grep`, `file_read`, `browser`) and keeps the `:ask` alias — only the system prompt changes.

---

## REPL reference

```
:agents              — list all modes (built-in + custom)
:ask                 — switch to ask mode
:plan                — switch to plan mode
:build               — switch to build mode
:agent <id>          — switch to any agent by id
:agent <unknown>     — shows "Agent not found. Try :agents to list available."
```
