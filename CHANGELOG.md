# Changelog

## v0.2.0 — 2026-04-03

Added 5 built-in skills, fixed skill loader, added startup safety check.

### What you can do now

- Invoke `/review`, `/investigate`, `/plan`, `/ship`, `/qa` directly from the REPL
- Pass file arguments: `/review src/core/agent.ts` focuses Codex on a specific file
- Skills auto-load from `~/.codex/skills/` — Codex CLI skills work in Phase2S without any extra config
- Startup check: clear install instructions if `codex` isn't found, instead of a cryptic error

### Fixes

- SKILL.md frontmatter now parsed with the `yaml` library (arrays, multi-line values, quoted strings all work)
- `~/.codex/skills/` added to the skill search path with name deduplication (project skills win)

---

## v0.1.0 — 2026-04-03

First working release of Phase2S.

### What you can do now

- Run `phase2s` to open an interactive REPL powered by OpenAI Codex
- Use `phase2s run "..."` for one-shot prompts
- Invoke 5 built-in skills: `/review`, `/investigate`, `/plan`, `/ship`, `/qa`
- Pass file arguments to skills: `/review src/core/agent.ts`
- Drop a SKILL.md in `.phase2s/skills/` and it becomes a `/command` instantly
- Skills auto-load from `~/.codex/skills/` — anything you've written for Codex CLI works here too

### Provider

Codex CLI provider (`codex exec --json --full-auto`). Non-interactive, terminal-safe — codex never touches `/dev/tty`, so the REPL stays alive across multiple turns.

Model is auto-detected from `~/.codex/config.toml`. No need to configure twice.

### Under the hood

- SKILL.md frontmatter parsed with the `yaml` library — supports arrays, multi-line values, quoted strings
- Startup check: if `codex` isn't on PATH, you get a clear install message instead of a cryptic error
- REPL uses a manual event queue (not readline's async iterator, which has a known issue with event loop draining between turns)
