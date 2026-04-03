# Changelog

## v0.4.0 — 2026-04-03

Sprint 2: test coverage expansion, CI, and the `/explain` skill.

### For contributors

- Test suite grows from 56 to 96 tests across 10 test files
- **New: `test/tools/glob.test.ts`** — 9 tests: pattern matching, recursive `**` globs, `cwd` sandbox enforcement, custom ignore, node_modules default ignore
- **New: `test/tools/grep.test.ts`** — 8 tests: case-insensitive search, `filePattern` filtering, `maxResults` truncation, sandbox enforcement
- **New: `test/core/registry.test.ts`** — 9 tests: all `ToolRegistry` methods plus all three error paths in `execute()` (unknown tool, invalid args, thrown error)
- **New: `test/skills/loader.test.ts`** — 10 tests: flat `.md` files, directory-based `SKILL.md`, YAML array triggers, malformed frontmatter, README skip, missing dirs, `sourcePath`, deduplication
- **CI: `.github/workflows/test.yml`** — `npm test` runs on every push and pull request, Node.js 22, `npm ci`

### Added

- **`/explain` skill** — ask Phase2S to explain any piece of code or concept in plain language. Say "explain this", "what does this do", or "walk me through this" and it breaks it down clearly, following the code top-to-bottom and explaining intent, not just mechanics.

---

## v0.3.0 — 2026-04-03

Test suite, security hardening, and tool behavior improvements.

### For contributors

- `npm test` now works — 54 unit tests across tools and core modules (vitest)
- Tests cover: `file_read`, `file_write`, `shell`, `Conversation`, `loadConfig`
- Tests are deterministic on any machine (temp dir isolation, `HOME` override)

### Security fixes

- **File sandbox enforced** — `file_read` and `file_write` now reject any path outside the project directory. The LLM can no longer read `~/.ssh/id_rsa` or write outside your repo.
- **Truncation guard** — `file_write` refuses to overwrite an existing file with empty content. Prevents silent data loss from an LLM that sends an empty string.
- **Error sanitization** — `file_read` and `file_write` strip absolute filesystem paths from error messages before returning them to the LLM.
- **YAML config errors surface** — a malformed `.phase2s.yaml` now shows you the parse error instead of silently ignoring it and using defaults.

### Bug fixes

- **Context trim was dropping tool results but leaving their paired assistant `tool_calls` references** — this would cause an OpenAI API 400 error on the next turn. Now the entire turn (assistant message + all its tool results) is dropped atomically.
- **Codex temp dir cleanup was dead code** — the exit handler was calling `Set.delete` instead of `rmSync`. Temp dirs now actually get removed when the process exits or crashes.

---

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
