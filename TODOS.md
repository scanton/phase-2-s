# Phase2S — TODO List

> **North star:** Phase2S is to Codex CLI what gstack is to Claude Code.
> A personal AI programming harness with a skill system, multi-model support,
> and enough structure to grow into a team-sized tool.

---

## Sprint 10 (done) — Memory, Meta-Skill, Security Hardening (v0.12.0)

| Metric | Value |
|--------|-------|
| Version | v0.12.0 |
| Skills | 28 |
| Tests | 205 |

- [x] **Session file security** — `Conversation.save()` accepts `mode?: number`. CLI passes `mode: 0o600` on both async save path (after each turn) and sync SIGINT path (`writeFileSync`). Session files now owner-only by default.
- [x] **Signal handler guard** — `_signalHandlersRegistered` flag in `codex.ts` prevents double-registration if the module is evaluated multiple times in vitest. Eliminates `MaxListenersExceededWarning` as test suite grows.
- [x] **Memory system** — `src/core/memory.ts`: `loadLearnings(cwd)` reads `.phase2s/memory/learnings.jsonl`, `formatLearningsForPrompt()` formats them for system prompt injection (capped at ~2000 chars, trims oldest first). `buildSystemPrompt()` accepts `learnings?: string`. `AgentOptions` gains `learnings?: string`. CLI loads and passes learnings in `interactiveMode()` and `oneShotMode()`.
- [x] **`/remember` skill** — saves a project learning to `.phase2s/memory/learnings.jsonl` via shell append. Asks what to remember and what type (preference, decision, pattern, constraint, tool). Writes one JSON line.
- [x] **`/skill` meta-skill** — guided interview (3 questions) → generates a SKILL.md file via file-write. Creates `.phase2s/skills/<name>/SKILL.md`. Phase2S can now create new skills from within a session.
- [x] Tests: memory system (9 in `test/core/memory.test.ts`), prompt learnings injection (3 in `test/utils/prompt.test.ts`), /remember + /skill skills (5 in built-in-skills.test.ts), session file mode (2 in conversation-persistence.test.ts), signal handler guard (1 in codex-hardening.test.ts). **205 tests total** (up from 186).

### MCP backlog (discovered in Sprint 9, deferred)

- [ ] **MCP skills reload** — skills added during a Claude Code session (e.g. via `/skill`) aren't visible to Claude Code until it restarts (MCP server loads skills at startup). Future: `tools/reload` method or session restart detection.
- [ ] **MCP tool calls stateless** — each `tools/call` invocation creates a fresh `Agent` and `Conversation`. Multi-turn skills (`/satori`, `/consensus-plan`) invoked via MCP start cold every call. Future: per-session conversation persistence in MCP server.

---

## Sprint 9 (done) — Claude Code MCP Integration (v0.11.0)

| Metric | Value |
|--------|-------|
| Version | v0.11.0 |
| Skills | 26 |
| Tests | 186 |

- [x] **`/adversarial` skill** — cross-model adversarial review with structured output (`VERDICT / STRONGEST_CONCERN / OBJECTIONS / APPROVE_IF`). `model: smart`. No interactive questions — designed for AI-to-AI invocation.
- [x] **MCP server** (`src/mcp/server.ts`) — JSON-RPC 2.0 over stdio. Handles `initialize`, `tools/list`, `tools/call`. Dynamic tool generation: every SKILL.md becomes a `phase2s__<name>` Claude Code tool at startup.
- [x] **`phase2s mcp` command** — added to `src/cli/index.ts`. Spawns the MCP server in the current working directory.
- [x] **`.claude/settings.json`** — project-level MCP config. No API key, no env vars. Claude Code spawns `phase2s mcp` automatically.
- [x] **`CLAUDE.md`** — routing rules telling Claude Code when to invoke Phase2S tools (adversarial review before plan execution, plan-review, scope-review, health, retro).
- [x] Tests: MCP server protocol (5), adversarial skill (4 in built-in-skills.test.ts + 2 helper tests). 186 tests total.

---

## Sprint 8 (done) — OMX Infrastructure (v0.10.0)

| Metric | Value |
|--------|-------|
| Version | v0.10.0 |
| Skills | 25 |
| Tests | 175 |

- [x] **Agent tier routing** — `fast_model` / `smart_model` config fields + `PHASE2S_FAST_MODEL` / `PHASE2S_SMART_MODEL` env vars. `model: fast` / `model: smart` in SKILL.md frontmatter resolved via `Agent.resolveModel()`.
- [x] **Persistent execution loop (satori)** — `agent.run()` accepts `maxRetries`, `verifyFn`, `preRun`, `postRun`. Satori loop injects failure context on retry. `addUser()` stays in outer `run()` — inner `runOnce()` does not re-add the user message.
- [x] **`/satori` skill** — SKILL.md with `retries: 3`, `model: smart`. Triggers: "satori", "run until tests pass", etc.
- [x] **Consensus planning** — `/consensus-plan` skill with Planner/Architect/Critic passes. APPROVED / APPROVED WITH CHANGES / REVISE output.
- [x] **Context snapshots** — `writeContextSnapshot()` in CLI writes git state + task to `.phase2s/context/` before satori runs.
- [x] **Underspecification gate** — `isUnderspecified()` with `UNDERSPEC_WORD_THRESHOLD = 15`. Gated by `requireSpecification: true` in config. Override with `force:` prefix.
- [x] **Satori log** — `writeSatoriLog()` writes `.phase2s/satori/<slug>.json` after each attempt with attempt count, pass/fail, failure lines.
- [x] Tests: config Sprint 8 (4), loader Sprint 8 (3), agent satori loop (7), built-in skills Sprint 8 (4). 175 tests total.

### OMX Infrastructure backlog (not yet implemented)

- [ ] **MCP state server** — shared state across agent turns via MCP protocol
- [ ] **Parallel teams** — multiple agents working in parallel on subtasks (tmux-style workers)
- [ ] **Notification gateway** — post-task notifications (Slack, email, webhook)
- [x] **`/skill` meta-skill** — done in Sprint 10. Guided interview creates SKILL.md files from within a session.

---

## Sprint 7 (done) — Execution Skills (5 new skills)

Ported from oh-my-codex (`$deep-interview` → `/deep-specify`, `$ai-slop-cleaner` → `/slop-clean`). Added original execution workflows for debug and TDD. Added documentation generation.

- [x] `/debug` — systematic debugging: reproduce → isolate → hypothesize → fix → verify. Saves logs to `.phase2s/debug/`.
- [x] `/tdd` — test-driven development: Red (failing tests) → Green (minimal impl) → Refactor. Reports coverage delta.
- [x] `/slop-clean` — anti-slop refactor pass: 5-smell taxonomy (dead code, duplication, needless abstraction, boundary violations, missing tests). One category at a time. Tests first.
- [x] `/deep-specify` — structured spec interview (ported from OMX `$deep-interview`): 3-5 Socratic questions, outputs Intent / Boundaries / Non-goals / Constraints / Success criteria to `.phase2s/specs/`.
- [x] `/docs` — inline documentation generation: JSDoc/TSDoc, type annotations, module headers. Documents git-changed files or a specified target.
- [x] Tests: `built-in-skills` Sprint 7 — 6 tests across all 5 new skills + total count sanity check (>=23). 157 tests total.

---

## Sprint 6 (done) — Skill Expansion (11 new skills)

- [x] `/retro` — weekly engineering retrospective: git commit analysis, velocity stats, one improvement focus
- [x] `/health` — code quality dashboard: runs tests, type check, lint; weighted score 0–10; persists history
- [x] `/audit` — security audit: secrets scan, dependency vulns, input validation, file sandbox, session security
- [x] `/plan-review` — engineering plan review: scope validation, architecture critique, test coverage map, perf analysis
- [x] `/checkpoint` — session state snapshot: infers git state + decisions, saves to `.phase2s/checkpoints/`
- [x] `/scope-review` — scope and ambition challenge: Expand / Hold / Reduce / Challenge modes
- [x] `/careful` — prompt-only safety mode: pauses before destructive shell commands, requires confirmation
- [x] `/freeze` — prompt-only edit restriction: limits file edits to a user-specified directory
- [x] `/guard` — combines careful + freeze: full safety mode
- [x] `/unfreeze` — clears the freeze/guard edit restriction
- [x] `/autoplan` — orchestrated review pipeline: runs scope-review + plan-review sequentially with auto-decision principles
- [x] Tests: `built-in-skills` — 12 tests across all 11 new skills + total count sanity check. 151 tests total.

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

### OMX Infrastructure (from oh-my-codex analysis, Sprint 7 backlog)

These are the power features from oh-my-codex that go beyond SKILL.md. They require infrastructure changes to Phase2S's core.

- [ ] **Agent tier routing** — LOW/STANDARD/THOROUGH tiers mapped to `fast_model`/`smart_model` in `.phase2s.yaml`. Skills declare their tier; agent picks the right model automatically. Foundation for model-per-skill.
- [ ] **Persistent execution loop** (`$ralph` pattern) — iterate on a task until done + verified by a second agent pass. Requires stateful skill protocol (session hooks or MCP state). High value for long-running coding tasks.
- [ ] **Consensus planning** (`$ralplan` pattern) — Planner → Architect → Critic multi-agent consensus, up to 5 iterations until approved plan emerges. Requires multi-model routing infrastructure.
- [ ] **Parallel team execution** (`$team` pattern) — spawn N parallel Codex workers in git worktrees via tmux. Phase2S spawns and coordinates, collects outputs. High complexity but unlocks parallel agent work.
- [ ] **MCP state server** — implement `src/mcp/` state server with `state_write`/`state_read`/`state_clear`. Gives skills durable cross-turn state (like OMX's `.omx/state/` via MCP). Required by persistent execution and consensus planning.
- [ ] **Notification gateway** — Telegram/Discord webhooks for long-running team operations. Alerts when a parallel run completes or errors. OMX uses OpenClaw.
- [ ] **Context snapshots** — mandatory `.phase2s/context/{task-slug}-{ts}.md` before execution: task, outcome, constraints, unknowns, codebase touchpoints. Prevents silent partial completion.
- [x] **`/skill` meta-skill** — done in Sprint 10. Guided interview (3 questions) generates a SKILL.md file via file-write. Creates `.phase2s/skills/<name>/SKILL.md` from within a session.
- [ ] **Underspecification gate** — block requests below a confidence threshold and require `force:` prefix to bypass. OMX's `!` prefix / `force:` pattern.

### General

- [ ] **Multi-model routing** — use different models for different tasks
  - Config: `fast_model: gpt-4o-mini`, `smart_model: o3`, `code_model: codex`
  - Skills declare which tier they need; agent picks automatically
- [ ] **MCP server integration** — expose Phase2S tools as an MCP server
  - Any MCP client (Claude Desktop, other agents) can use phase2s tools
  - Inverse: consume external MCP servers as tools in the agent loop
- [ ] **oh-my-codex-style multi-agent** — route subtasks to specialized sub-agents
  - Orchestrator assigns tasks; specialist agents (coder, reviewer, tester) execute
  - Each specialist has its own tool set and system prompt
- [x] **Persistent memory across sessions** — done in Sprint 10. `loadLearnings()` + `formatLearningsForPrompt()` in `src/core/memory.ts`. Injected into system prompt via `AgentOptions.learnings`. CLI loads automatically from `.phase2s/memory/learnings.jsonl`. `/remember` skill writes new learnings.
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
- ~~**Signal handler test side effects**~~ — Fixed in Sprint 10. `_signalHandlersRegistered` guard flag in `codex.ts` prevents duplicate handler registration if the module is evaluated multiple times.
- **`--full-auto` + poisoned session file threat model** — `phase2s --resume` injects arbitrary prior messages into the agent context. A crafted session file with plausible-looking assistant messages could influence the model to skip safety checks or run destructive commands under `--full-auto`. The role validation added in Sprint 5 blocks outright invalid roles, but a semantically poisoned (but structurally valid) session is not blocked. Threat model: only relevant if session files can be written by untrusted parties. Document the assumption that `.phase2s/sessions/` is user-private.
- **Prompt size cap before codex spawn** — No limit on prompt length before spawning codex. A very long conversation history passed via `--resume` could exceed codex's context limit, resulting in a cryptic spawn error. Fix: add a `conversation.trimToTokenBudget()` call before constructing the first codex prompt, or warn when `conversation.estimateTokens()` exceeds a threshold.
- ~~**Session files world-readable**~~ — Fixed in Sprint 10. `Conversation.save()` accepts `mode?: number`; CLI passes `0o600` on both async and sync write paths.

---

## Icebox (maybe never, but worth tracking)

- GUI / TUI mode — a terminal dashboard showing the agent loop in real-time
- Plugin system — third-party skills installable via npm
- Team mode — shared skill library + shared session history for a dev team
- Self-hosting — run phase2s as a web service with a REST API
