# Phase2S Workflow Guide

A quick reference for choosing the right command for the job.

---

## Core mental model

Phase2S has two primary execution surfaces:

| Surface | Command | Best for |
|---------|---------|----------|
| **Interactive REPL** | `phase2s` | Conversation, exploration, iterating on ideas |
| **Autonomous task** | `phase2s go "<task>"` | Fire-and-forget: implement, fix, refactor |
| **Conductor pipeline** | `phase2s conduct "<goal>"` | Multi-agent orchestration across many subtasks |

---

## Single tasks

### Interactive (REPL)

Start a session and converse:

```bash
phase2s
```

Switch modes mid-session:
```
:ask    — read-only Q&A (fast model)
:plan   — write plans to plans/ only (smart model)
:build  — full read-write access (default, smart model)
```

Run an autonomous task without leaving the REPL:
```
:go fix the null pointer in auth.ts
:go add pagination to the users endpoint
```

### One-shot

Run a single prompt and exit:
```bash
phase2s run "explain how session locking works"
```

### Autonomous task

Let the agent plan, chain tools, and verify — hands-off:
```bash
phase2s go "fix the failing tests in auth.test.ts"
phase2s go "add rate limiting to the API" --verify "npm test"
phase2s go "refactor config.ts to use zod" --quiet
```

Options:
- `--verify <cmd>` — run this after every file write and inject the result
- `--quiet` — suppress per-turn streaming; print only the final result
- `--timeout <seconds>` — abort after N seconds
- `--output <file>` — write final result to a file

---

## Multi-agent pipeline (Conductor)

For goals that decompose into parallel subtasks:

```bash
phase2s conduct "add full-text search to the API"
phase2s conduct "migrate the test suite to vitest" --dry-run
phase2s conduct "add rate limiting + docs + tests" --yes
```

### Check conductor status

```bash
phase2s conduct-status           # run built-in QA cases for spec generation
phase2s conduct-status --ci      # exit 1 if any case fails (CI gate)
```

### View past runs

```bash
phase2s runs                     # show 10 most recent conductor runs
phase2s runs --last              # show only the most recent
phase2s runs --limit 20          # show 20 entries
phase2s runs --json              # raw JSONL output
```

---

## Skills

Phase2S ships 29 built-in skills invokable from the REPL or one-shot:

```bash
phase2s run "/review"            # code review
phase2s run "/debug"             # root-cause a bug
phase2s run "/health"            # codebase quality score
phase2s run "/audit"             # security audit
phase2s run "/ship"              # commit prep
phase2s skills                   # list all available skills
```

---

## Choosing the right tool

| Situation | Command |
|-----------|---------|
| I want to ask a question | `phase2s` → `:ask` |
| I want to write a plan before coding | `phase2s` → `:plan` |
| I want to implement something | `phase2s` → `:build` |
| I want to implement hands-off | `phase2s go "<task>"` |
| I want to run a big multi-step goal | `phase2s conduct "<goal>"` |
| I want to run a skill | `phase2s run "/<skill>"` |
| I want to review a diff | `phase2s run "/review"` |
| I want to debug a bug | `phase2s run "/debug"` |

---

## MCP integration (Claude Code)

Phase2S exposes all commands and skills as MCP tools when configured in `.claude/settings.json`. Tools are named `phase2s__<command>`:

- `phase2s__go` — autonomous task executor
- `phase2s__conduct` — multi-agent conductor pipeline
- `phase2s__conduct_status` — conductor QA gate
- `phase2s__adversarial` — cross-model plan challenge
- `phase2s__task` — (alias for `phase2s__go`, kept for compatibility)

See [claude-code.md](claude-code.md) for setup instructions.
