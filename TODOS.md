# Phase2S — TODO List

> **North star:** Phase2S is to Codex CLI what gstack is to Claude Code.
> A personal AI programming harness with a skill system, multi-model support,
> and enough structure to grow into a team-sized tool.

---

## Sprint 2 (current) — Expand Coverage + CI + /explain

- [x] Tests: `glob` tool — pattern matching, recursive, sandbox, ignore (9 tests)
- [x] Tests: `grep` tool — case flag, filePattern, maxResults, sandbox (8 tests)
- [x] Tests: `skills/loader` — YAML frontmatter, deduplication, search paths (10 tests)
- [x] Tests: `ToolRegistry` — register, execute, list, toOpenAI(), throw recovery (9 tests)
- [x] Add CI (GitHub Actions on push) — `.github/workflows/test.yml`, Node.js 22
- [x] `/explain` skill — TDD: test first, then SKILL.md (5 tests, `{{target}}` placeholder)

## Sprint 1 (done) — Tests + Foundation

- [x] Set up vitest test framework (`npm test`)
- [x] Tests: `file_read` tool — sandbox, line ranges, error sanitization (11 tests)
- [x] Tests: `file_write` tool — sandbox, empty write guard, createDirs (8 tests)
- [x] Tests: `shell` tool — exit codes, timeout, cwd, schema validation (10 tests)
- [x] Tests: `Conversation` — token estimation, trimToTokenBudget, immutability (12 tests)
- [x] Tests: `loadConfig` — defaults, env var precedence, schema validation (10 tests)

---

## Near-term (v0.3.0) — OpenAI Provider + Polish

- [ ] **Complete openai-api provider** — wire tool calling end-to-end
  - Handle `finish_reason: "length"` and `"content_filter"` gracefully
  - Test with `file_read`, `shell`, and `glob` tools via direct API
- [ ] **Model-per-skill config** — `model: o3-mini` in SKILL.md frontmatter overrides default
  - Cheap model for fast skills (investigate, grep), smart model for complex ones (plan, review)
- [ ] **Codex arg injection hardening** — prompt is passed as a CLI arg; investigate `--prompt-file`
  - Risk: prompt content containing `--flags` could be parsed by codex as its own flags
  - Mitigation: use `--` separator or write prompt to a temp file
- [ ] **Shell tool hardening** — currently warns but does not block destructive commands
  - Decision needed before npm publish: block or keep warn-only?
  - Options: (a) hard block on explicit list, (b) require confirmation flag in config, (c) warn-only
- [ ] **npm publish** — `npm publish --access public` as `phase2s`
  - Needs: README polish, license check, entry point verification

---

## Medium-term (v0.4.0–v0.5.0) — Power Features

- [ ] **Streaming output** — stream LLM responses as they arrive instead of buffering
  - OpenAI provider: use `stream: true` with async iterator
  - Codex provider: parse JSONL events from stdout in real-time
  - UX: show partial response in terminal as it streams
- [ ] **Conversation persistence** — save/restore session history to `.phase2s/sessions/`
  - Resume a previous session: `phase2s --resume`
  - Useful for long debugging sessions or code review workflows
- [ ] **Multi-turn skills** — skills that ask follow-up questions mid-workflow
  - Today skills are static prompt templates; this makes them interactive
- [ ] **`/plan` skill improvement** — output structured task list, not just prose
  - Write plan to `.phase2s/plans/YYYY-MM-DD.md`
  - Integration with TODOS.md (append generated tasks)
- [ ] **`/diff` skill** — review a git diff with structured feedback
  - Useful post-commit or pre-PR
- [ ] **Configurable tool allow/deny list** — per-project `.phase2s.yaml`
  - `tools: [file_read, shell]` — only enable listed tools
  - `deny: [shell]` — disable specific tools

---

## Long-term (v1.0+) — Multi-model + Ecosystem

- [ ] **Multi-model routing** — use different models for different tasks
  - Config: `fast_model: gpt-4o-mini`, `smart_model: o3`, `code_model: codex`
  - Skills declare which tier they need; agent picks automatically
- [ ] **MCP server integration** — expose Phase2S tools as an MCP server
  - Any MCP client (Claude Desktop, other agents) can use phase2s tools
  - Inverse: consume external MCP servers as tools in the agent loop
- [ ] **oh-my-codex-style multi-agent** — route subtasks to specialized sub-agents
  - Orchestrator assigns tasks; specialist agents (coder, reviewer, tester) execute
  - Each specialist has its own tool set and system prompt
- [ ] **Persistent memory across sessions** — per-project learnings in `.phase2s/memory/`
  - Automatically inject relevant past learnings into system prompt
  - Similar to gstack's `learnings.jsonl` system
- [ ] **Browser tool** — headless browser via Playwright for web research
  - Used by `/qa` skill (test sites), `/browse` skill (research), `/investigate` (docs lookup)
- [ ] **More provider support** — Anthropic Claude, local Ollama, Gemini
  - Provider interface already abstracted; just implement `chat()`
- [ ] **GitHub Actions integration** — run phase2s as a CI step
  - `/review` on every PR, `/qa` on every deploy, `/investigate` on test failures
- [ ] **VS Code extension** — run skills from the editor sidebar
  - `/review` on current file, `/investigate` on selected error, `/plan` for a feature

---

## Known Issues / Technical Debt

- `codex.ts`: prompt is passed as a CLI argument — arg injection risk if prompt contains `--flags`
- `shell.ts`: warns on destructive commands but doesn't block them
- `openai.ts`: doesn't handle `finish_reason: "length"` (silently drops truncated responses)
- `conversation.ts`: token estimation is ~4 chars/token — rough; use `tiktoken` for precision
- `file-read.ts`, `file-write.ts`: sandbox uses `resolve()` not `realpath()` — symlinks inside the project that point outside cwd bypass the sandbox. Accepted risk for personal use (requires a malicious symlink already in your repo). Fix with `realpath()` before ship.
- No integration tests (only unit tests so far)
- CI added (GitHub Actions, Node.js 22) — no deploy step yet (CLI tool)

---

## Icebox (maybe never, but worth tracking)

- GUI / TUI mode — a terminal dashboard showing the agent loop in real-time
- Plugin system — third-party skills installable via npm
- Team mode — shared skill library + shared session history for a dev team
- Self-hosting — run phase2s as a web service with a REST API
