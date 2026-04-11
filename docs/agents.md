# Named Agents

Phase2S ships three built-in agent personas. Each has a specific job, a specific model tier, and a hard-wired tool set enforced at the registry level — not just in the system prompt.

Switch between them mid-session without losing your conversation history. The tool registry and system prompt change; everything else stays.

---

## The A-team

| Agent | Switch to | Model | Tools | Best for |
|-------|-----------|-------|-------|----------|
| **Ares** | `:build` or `ares` | smart | all tools | Writing code, running tests, making changes |
| **Apollo** | `:ask` or `apollo` | fast | glob, grep, file_read, browser | Questions, exploration, code review |
| **Athena** | `:plan` or `athena` | smart | read tools + plans_write | Design docs, architecture plans, specs |

### Ares — The builder

Default agent. Full tool access: read tools, `shell`, `file_write`, `browser`. Use Ares when you want Phase2S to actually change things.

```
you > :build
→ Switched to: ares (Implement and build)

you > implement the pagination logic from plans/pagination.md
```

### Apollo — The reader

Read-only. Fast model. Cannot write files, cannot run shell commands. Use Apollo for quick questions, code exploration, and anything where you want an answer without side effects.

```
you > :ask
→ Switched to: apollo (Research and explain)

you > how does the session locking work in session.ts?
```

Apollo's tool restriction is hard. `file_write` and `shell` are not in its registry at all — they're not hidden by a system prompt instruction that could be overridden. Apollo literally cannot write a file even if you ask it to.

### Athena — The planner

Smart model. Reads everything, writes only to `plans/`. Use Athena to think through a design before building it. Plans go to `plans/` and are sandboxed there — Athena cannot touch source files.

```
you > :plan
→ Switched to: athena (Plan and design)

you > design the rate limiting system — what are the tradeoffs between in-memory and Redis?
```

Athena's `plans_write` tool auto-creates `plans/` if it doesn't exist, and refuses to truncate an existing plan file to empty content.

---

## Switching agents

```bash
:ask        # Switch to Apollo (read-only, fast)
:plan       # Switch to Athena (planning, smart)
:build      # Switch to Ares (full access, smart)

apollo      # Same as :ask (bare id)
athena      # Same as :plan (bare id)
ares        # Same as :build (bare id)

:agent <id> # Switch to any agent by id (including custom agents)
:agents     # List all available agents with aliases, model, and tool count
```

Your conversation history is preserved. The tool registry and system prompt are swapped in place.

### Resume persistence

When you run `phase2s --resume`, the active agent is restored. If the saved agent no longer exists (e.g., you removed a custom agent), Phase2S falls back to Ares with a warning.

---

## Custom agents

Add a `.phase2s/agents/<name>.md` file to your project. Phase2S picks it up automatically on the next session start.

```markdown
---
id: scout
title: "Scout — fast codebase explorer"
model: fast
tools:
  - glob
  - grep
  - file_read
aliases:
  - ":scout"
---

You are a fast, read-only codebase explorer. Your job is to find things quickly and explain them clearly. Never suggest changes. Always cite file paths and line numbers.
```

Switch to it with `:scout`, `:agent scout`, or `scout`.

### Model tiers

`model` in the frontmatter accepts:
- `fast` — maps to `fast_model` in your config (default: `gpt-4o-mini` or equivalent)
- `smart` — maps to `smart_model` in your config (default: `gpt-4o` or equivalent)
- Any literal model name — e.g., `gpt-4o`, `claude-3-5-sonnet-20241022`

---

## Override-restrict policy

You can override a built-in agent's system prompt by placing a `.phase2s/agents/apollo.md` in your project. The override can:

- **Narrow the tool list** — give Apollo fewer tools than it ships with
- **Change the system prompt** — customize how Apollo behaves in your project

The override **cannot**:

- **Expand the tool list** — a project override of Apollo cannot add `shell` or `file_write`. Phase2S will warn and ignore any tools not in the built-in's list.
- **Steal a built-in alias** — a custom agent (new id) that declares `:build` as an alias will have that alias silently dropped. Built-in aliases are protected.

`tools: []` in an override is treated as explicit deny-all, not "no restriction."

### Inheritance

If your override has no `tools:` field, the built-in's tool list is inherited. This is the most common case: you want to customize Apollo's instructions without changing what it can do.

```markdown
---
id: apollo
title: "Apollo — project-specific researcher"
---

You are a read-only research assistant. When asked about this codebase, always
reference the ADR docs in docs/adr/ first. Cite specific line numbers.
```

This override inherits Apollo's tool list (`glob`, `grep`, `file_read`, `browser`) and keeps the `:ask` alias — only the system prompt changes.

---

## REPL reference

```
:agents              — list all agents (built-in + custom)
:ask / apollo        — switch to Apollo
:plan / athena       — switch to Athena
:build / ares        — switch to Ares
:agent <id>          — switch to any agent by id
:agent <unknown>     — shows "Agent not found. Try :agents to list available."
```
