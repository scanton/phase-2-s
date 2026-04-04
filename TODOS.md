# Phase2S — TODO List

> **North star:** Phase2S is to Codex CLI what gstack is to Claude Code.
> A personal AI programming harness with a skill system, multi-model support,
> and enough structure to grow into a team-sized tool.

---

## Sprint 2 (done) — Expand Coverage + CI + /explain

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

## Sprint 5 (done) — Security Hardening + Persistence + /diff

- [x] **Sandbox `realpath()` fix** — extracted `src/tools/sandbox.ts` with `assertInSandbox()`. Both `file-read` and `file-write` now use `realpath()` before sandbox check. Symlinks inside project pointing outside cwd are blocked. v0.7.0.
- [x] **Codex arg injection hardening** — added `"--"` separator in args array before prompt in `codex.ts`. Prompts starting with `--` are no longer misread by codex's arg parser. Also added SIGTERM/SIGINT handlers for temp dir cleanup. v0.7.0.
- [x] **Conversation persistence** — `Conversation.save(path)` and `Conversation.load(path)` added. CLI auto-saves to `.phase2s/sessions/<date>.json` after each turn. `phase2s --resume` loads the most recent session. v0.7.0.
- [x] **`/diff` skill** — review uncommitted or last-commit changes with structured feedback. Triggers: "what changed", "review this diff", "check my diff". LOOKS GOOD / NEEDS REVIEW / RISKY verdict. v0.7.0.

---

## Sprint 4 (done) — Streaming + npm Publish

- [x] **`PHASE2S_ALLOW_DESTRUCTIVE` env var** — `if (process.env.PHASE2S_ALLOW_DESTRUCTIVE === "true") envConfig.allowDestructive = true` added to `loadConfig()` in `src/core/config.ts`. v0.6.0.
- [x] **Streaming output** — `Provider.chat()` replaced by `chatStream(): AsyncIterable<ProviderEvent>`. OpenAI streams with `stream: true` + per-index tool call fragment accumulation. Codex passthrough wrapper. CLI streams via `onDelta?` callback on `Agent.run()`. v0.6.0.
- [x] **README polish for npm publish** — install-first user-facing README rewrite. v0.6.0.
- [ ] **npm publish** *(low priority — deferred until more features ship)* — Tarball and workflow ready. Set `NPM_TOKEN` repo secret, run `git tag v0.6.0 && git push origin v0.6.0` to trigger `.github/workflows/publish.yml`.

---

## Near-term (v0.3.0) — OpenAI Provider + Polish

- [x] **Complete openai-api provider** — wire tool calling end-to-end ← done Sprint 3
  - Handle `finish_reason: "length"` and `"content_filter"` gracefully
  - Test with `file_read`, `shell`, and `glob` tools via direct API
- [ ] **Model-per-skill config** — `model: o3-mini` in SKILL.md frontmatter overrides default
  - Cheap model for fast skills (investigate, grep), smart model for complex ones (plan, review)
  - Deferred from Sprint 5 (no current consumers; implement when a skill actually needs it)
  - Future: consider model-tier config (`fast_model`, `smart_model` in `.phase2s.yaml`) instead of per-skill strings
- [x] **Codex arg injection hardening** — `"--"` separator added to args array before prompt. Done Sprint 5. v0.7.0.
- [x] **Shell tool hardening** — blocks destructive commands by default ← done Sprint 3
  - `allowDestructive: false` default; set `true` in `.phase2s.yaml` to unlock
- [ ] **npm publish** *(low priority — deferred)* — See Sprint 4 section above. README done, license MIT, entry point verified. Pending: NPM_TOKEN secret + tag push.

---

## Medium-term (v0.4.0–v0.5.0) — Power Features

- [x] **Streaming output** — done in Sprint 4 (v0.6.0). OpenAI streams; Codex passthrough wrapper. Real Codex JSONL streaming still deferred (format undocumented).
- [x] **Conversation persistence** — done Sprint 5. `Conversation.save/load`, `--resume` flag, auto-save after each turn. v0.7.0.
- [ ] **Multi-turn skills** — skills that ask follow-up questions mid-workflow
  - Today skills are static prompt templates; this makes them interactive
- [ ] **`/plan` skill improvement** — output structured task list, not just prose
  - Write plan to `.phase2s/plans/YYYY-MM-DD.md`
  - Integration with TODOS.md (append generated tasks)
- [x] **`/diff` skill** — done Sprint 5. Structured diff review with LOOKS GOOD / NEEDS REVIEW / RISKY verdict. v0.7.0.
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

- `codex.ts`: prompt is passed as a CLI argument — arg injection risk if prompt contains `--flags` ← fixed in Sprint 5 (`"--"` separator)
- `shell.ts`: warns on destructive commands but doesn't block them ← fixed in Sprint 3
- `openai.ts`: doesn't handle `finish_reason: "length"` (silently drops truncated responses) ← fixed in Sprint 3
- `conversation.ts`: token estimation is ~4 chars/token — rough; use `tiktoken` for precision
- `file-read.ts`, `file-write.ts`: sandbox uses `resolve()` not `realpath()` — symlinks inside the project that point outside cwd bypass the sandbox. ← fixed in Sprint 5 (`assertInSandbox()` with `realpath()`)
- No integration tests (only unit tests so far) ← fixed in Sprint 3 (8 agent integration tests)
- CI added (GitHub Actions, Node.js 22) — no deploy step yet (CLI tool)
- `agent.ts`: provider display log showed "codex-cli" even when `PHASE2S_PROVIDER=openai-api` — fixed in Sprint 4 (now reads `this.provider.name`).

### INVESTIGATE (deferred from Sprint 5 adversarial review)

These were flagged but not fixed — they need deeper analysis before touching.

- **TOCTOU race in `assertInSandbox`** — There is a window between `assertInSandbox()` returning a resolved path and `writeFile(fullPath, ...)` actually writing. An attacker who can swap the file for a symlink in that window could redirect the write. Mitigating: the window is microseconds and requires local process control; fix would require `O_NOFOLLOW`-style atomic open, which Node.js `fs` doesn't expose directly. Worth a spike to see if `open(fd, O_WRONLY | O_NOFOLLOW)` via a native addon is feasible.
- **`SESSION_DIR` captured at module load** — `const SESSION_DIR = join(process.cwd(), ...)` in `cli/index.ts` runs when the module is imported, not when `main()` runs. If `cwd` changes before `main()` (unlikely in practice, but possible in programmatic use), the session path would be wrong. Fix: move to a lazy getter or compute inside `interactiveMode()`.
- **Signal handler test side effects** — The SIGTERM/SIGINT handlers registered in `codex.ts` are process-global and persist across test runs in the same vitest worker. A test that spawns a Codex provider but doesn't clean it up will leave orphaned handlers. Could cause `MaxListenersExceededWarning`. Fix: deregister handlers when the provider instance is done, or use `AbortController` pattern.
- **`--full-auto` + poisoned session file threat model** — `phase2s --resume` injects arbitrary prior messages into the agent context. A crafted session file with plausible-looking assistant messages could influence the model to skip safety checks or run destructive commands under `--full-auto`. The role validation added in Sprint 5 blocks outright invalid roles, but a semantically poisoned (but structurally valid) session is not blocked. Threat model: only relevant if session files can be written by untrusted parties. Document the assumption that `.phase2s/sessions/` is user-private.
- **Prompt size cap before codex spawn** — No limit on prompt length before spawning codex. A very long conversation history passed via `--resume` could exceed codex's context limit, resulting in a cryptic spawn error. Fix: add a `conversation.trimToTokenBudget()` call before constructing the first codex prompt, or warn when `conversation.estimateTokens()` exceeds a threshold.
- **Session files world-readable** — `writeFile(path, content, "utf-8")` creates files with the process umask (typically `0o644`). Session files contain conversation history including potentially sensitive prompts, code, and file contents. Fix: use `writeFile(path, content, { encoding: "utf-8", mode: 0o600 })` to restrict to owner-only. Low risk on single-user machines; higher risk on shared systems.

---

## Icebox (maybe never, but worth tracking)

- GUI / TUI mode — a terminal dashboard showing the agent loop in real-time
- Plugin system — third-party skills installable via npm
- Team mode — shared skill library + shared session history for a dev team
- Self-hosting — run phase2s as a web service with a REST API
