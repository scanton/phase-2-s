# Changelog

## v0.17.0 — 2026-04-04

Sprint 14: Multi-provider support — Anthropic and Ollama.

### What you can do now

- **Run skills on Claude** — set `provider: anthropic` in `.phase2s.yaml` and every one of the 29 skills runs on Claude 3.5 Sonnet (or any Claude model you specify). Same `/adversarial`, `/satori`, `/consensus-plan` — now with Anthropic's API. Reads `ANTHROPIC_API_KEY` from env automatically.
- **Run skills locally, free, private** — set `provider: ollama` and `model: qwen2.5-coder:7b` (or any model you have pulled) and the entire skill library runs on your machine. No API keys. Works offline. Free after the initial model pull.
- **Switch providers with one line** — the only change needed is `provider:` in `.phase2s.yaml`. No other config required.

### New config fields

- `provider: anthropic | ollama` — two new values alongside the existing `codex-cli` and `openai-api`
- `anthropicApiKey` — Anthropic API key (falls back to `ANTHROPIC_API_KEY` env var)
- `anthropicMaxTokens` — max tokens for Anthropic responses (default `8192`)
- `ollamaBaseUrl` — Ollama server base URL (default `http://localhost:11434/v1`)
- Default models: `anthropic` → `claude-3-5-sonnet-20241022`, `ollama` → `llama3.1:8b`

### For contributors

- **`src/providers/anthropic.ts`** — New `AnthropicProvider` implementing `Provider`. Translates Anthropic streaming events (`content_block_delta`, `tool_use` blocks, `message_stop`) to the shared `ProviderEvent` format. Exports `translateMessages()` for direct testing — handles system message extraction, assistant tool-call turns, and consecutive tool-result folding into single synthetic user messages.
- **`src/providers/ollama.ts`** — `createOllamaProvider()` factory. Reuses `OpenAIProvider` with `baseURL` injection — Ollama's OpenAI-compatible API requires no new class.
- **`src/providers/index.ts`** — `createProvider()` extended for `"anthropic"` and `"ollama"` cases.
- **`src/core/config.ts`** — Provider enum extended to 4 values. New optional fields: `anthropicApiKey`, `anthropicMaxTokens`, `ollamaBaseUrl`. `ANTHROPIC_API_KEY` env var wired. `resolveDefaultModel()` returns correct defaults per provider.
- **267 tests** (up from 249). New: `test/providers/anthropic.test.ts` (12 tests), `test/providers/ollama.test.ts` (4 tests), +2 config tests.

## v0.15.0 — 2026-04-04

Sprint 12: MCP hot-reload and session persistence.

### What you can do now

- **Skills hot-reload** — create a new skill with `/skill` during a Claude Code session and it becomes available as a Claude Code tool automatically, without restarting the MCP server. The server watches `.phase2s/skills/` for new entries and sends `notifications/tools/list_changed` to the client per MCP spec.
- **MCP session persistence** — multi-turn skills like `/satori` and `/consensus-plan` now maintain conversation history across multiple `tools/call` invocations in the same Claude Code session. Each skill gets its own `Conversation` that lives for the lifetime of the `phase2s mcp` subprocess. Previously every call started cold.

### For contributors

- **`src/mcp/server.ts`** — Added `MCPNotification` interface, `buildNotification()` helper, `setupSkillsWatcher()` (exported, tested in isolation). `handleRequest()` gains optional `sessionConversations?: Map<string, Conversation>` fourth parameter — backward-compatible. `initialize` response now includes `capabilities: { tools: { listChanged: true } }`. `runMCPServer()` creates the session map and wires the watcher.
- **`test/mcp/server.test.ts`** — Updated `MockAgent` to include `getConversation()`. 6 new tests: capabilities advertisement, `buildNotification` format, session map population, conversation reuse, per-skill isolation, stateless fallback.
- **`test/mcp/watcher.test.ts`** — New file. 4 tests for `setupSkillsWatcher`: watcher registration, debounced reload + notify, debounce coalescing, missing-directory error handling. Mocks `node:fs` in isolation.
- **220 tests total** (up from 209).

## v0.13.0 — 2026-04-04

Sprint 11: `/land-and-deploy` skill — push, PR, CI wait, merge.

### What you can do now

- **`/land-and-deploy`** — the missing link between `/ship` (commit) and production. Push the current branch, create or find the PR via `gh` CLI, wait for CI checks to pass, merge, delete the remote branch, and confirm the land. Handles the common failure paths cleanly: uncommitted changes, push conflicts, CI failures, merge conflicts — stops with a clear message at each, no silent failures, no force-push without instruction. Requires `gh` CLI installed and authenticated.

### For contributors

- **`.phase2s/skills/land-and-deploy/SKILL.md`** — new skill file. 7-step process covering state check, push, PR creation/discovery, CI wait, merge, and post-merge confirmation.
- **`test/skills/built-in-skills.test.ts`** — 3 new tests (name/triggers, prompt coverage, total count ≥ 29). **208 tests total** (up from 205).
- **`docs/skills.md`** — `/land-and-deploy` section added under Planning and shipping. Count updated to 29.
- **`docs/workflows.md`** — Step 5 (land-and-deploy) added to the "Starting a new feature" workflow.
- **`README.md`** — skill count updated to 29, `/land-and-deploy` added to highlights and roadmap.

## v0.12.0 — 2026-04-04

Sprint 10: Persistent memory, meta-skill (/skill), session security hardening, and signal handler guard.

### What you can do now

- **Persistent memory** — Phase2S now remembers your project preferences, decisions, and lessons across sessions. On startup, it loads `.phase2s/memory/learnings.jsonl` and injects up to 2000 characters of learnings into the system prompt. The agent knows your project's conventions without you having to re-explain them every session.
- **`/remember`** — save a learning to memory with one command. Ask Phase2S to remember anything: "remember this: we use vitest not jest", "remember that the codex binary is at /opt/homebrew/bin/codex". Two follow-up questions (what to remember, what type), then it appends a JSON line to `.phase2s/memory/learnings.jsonl`. The next session picks it up automatically.
- **`/skill`** — create a new Phase2S skill from inside Phase2S. Three questions (what it does, what phrases trigger it, which model tier), then Phase2S writes the SKILL.md to `.phase2s/skills/<name>/SKILL.md`. No manual YAML editing required. Phase2S can now extend itself.
- **Session file security** — session files (`.phase2s/sessions/*.json`) are now written with `mode: 0o600` (owner-read/write only). On shared or multi-user systems, conversation history is no longer world-readable. Both write paths (normal save after each turn + SIGINT emergency save) are fixed.

### For contributors

- **`src/core/memory.ts`** — new file. `loadLearnings(cwd)`: reads JSONL, skips invalid lines silently, returns `Learning[]`. `formatLearningsForPrompt(learnings)`: formats for system prompt injection, trims oldest first if over 2000 chars.
- **`src/utils/prompt.ts`** — `buildSystemPrompt()` gains optional `learnings?: string` third parameter. Appended after custom prompt if non-empty.
- **`src/core/agent.ts`** — `AgentOptions` gains `learnings?: string`. Passed to `buildSystemPrompt()` in constructor.
- **`src/core/conversation.ts`** — `save()` gains optional `mode?: number` parameter. Passed to `writeFile()` options when specified.
- **`src/cli/index.ts`** — `interactiveMode()` and `oneShotMode()` both call `loadLearnings(process.cwd())` and pass formatted string to `new Agent(...)`. Async save uses `mode: 0o600`. Sync SIGINT save uses `{ encoding: "utf-8", mode: 0o600 }`. VERSION bumped to `"0.12.0"`.
- **`src/providers/codex.ts`** — `_signalHandlersRegistered` guard flag wraps all three signal handler registrations (`exit`, `SIGTERM`, `SIGINT`). Prevents `MaxListenersExceededWarning` when vitest re-evaluates the module across test files.
- **2 new SKILL.md files** — `.phase2s/skills/remember/SKILL.md`, `.phase2s/skills/skill/SKILL.md`.
- **5 new test files/sections** — `test/core/memory.test.ts` (9 tests), `test/utils/prompt.test.ts` (3 tests), built-in skills Sprint 10 section (5 tests), conversation persistence mode tests (2 tests), codex hardening guard test (1 test). **205 tests total** (up from 186).

### MCP backlog (deferred to Sprint 11)

- **MCP skills reload** — skills added mid-session via `/skill` aren't visible to Claude Code until restart. Future: `tools/reload` method.
- **MCP tool calls stateless** — each `tools/call` creates a fresh agent. Multi-turn MCP skills start cold every call. Future: per-session conversation persistence in MCP server.

## v0.11.0 — 2026-04-04

Sprint 9: Claude Code MCP integration — Phase2S skills as Claude Code tools, `/adversarial` skill, and cross-model review.

### What you can do now

- **`phase2s mcp`** — start Phase2S as an MCP server. Claude Code spawns it automatically when `.claude/settings.json` is present in your project root. Every Phase2S skill becomes a `phase2s__<name>` Claude Code tool, loaded dynamically at startup. Add a SKILL.md, get a new tool. No code changes required.
- **`/adversarial`** — cross-model adversarial review designed for AI-to-AI invocation. Paste a plan or decision as input. Get back a structured verdict: `VERDICT: APPROVED | CHALLENGED | NEEDS_CLARIFICATION`, plus `STRONGEST_CONCERN`, `OBJECTIONS` (up to 3, specific and falsifiable), and `APPROVE_IF`. No interactive questions. Machine-readable output. When Claude Code (Claude, Anthropic) calls this via MCP, Phase2S (GPT-4o via Codex CLI) does the challenging. Different model, different training, no stake in agreeing.
- **Claude Code routing** — `CLAUDE.md` in the project root tells Claude Code when to invoke Phase2S tools automatically: adversarial review before significant plans, plan-review on engineering specs, health checks after sprints, etc.

### For contributors

- **`src/mcp/server.ts`** — new file. Exports `runMCPServer(cwd)`, `handleRequest(request, skills, cwd)` (testable without stdio), `skillToTool(skill)`, `toolNameToSkillName(toolName)`, and `MCP_SERVER_VERSION`. Uses same manual event-queue pattern as the CLI REPL to avoid the readline async iterator issue.
- **`src/cli/index.ts`** — `phase2s mcp` subcommand added. VERSION bumped to `"0.11.0"`.
- **`.claude/settings.json`** — project-level MCP server config. `command: "phase2s", args: ["mcp"]`. No env vars.
- **`CLAUDE.md`** — routing rules for Phase2S MCP tools added alongside existing gstack skill routing.
- **`.phase2s/skills/adversarial/SKILL.md`** — `model: smart`, no retries, no interactive steps. Output format enforced in prompt: VERDICT / STRONGEST_CONCERN / OBJECTIONS / APPROVE_IF.
- **11 new tests** — MCP server (7 in `test/mcp/server.test.ts`), adversarial skill (4 in `test/skills/built-in-skills.test.ts`). **186 tests total** (up from 175).

## v0.10.0 — 2026-04-04

Sprint 8: OMX Infrastructure — satori persistent execution loop, consensus-plan, agent tier routing (fast_model/smart_model), context snapshots, and underspecification gate.

### What you can do now

- **`/satori`** — persistent execution until verified complete. Runs a task, verifies with `npm test` (or `verifyCommand`), retries on failure (up to 3 times), injects failure context on each retry. Writes a context snapshot to `.phase2s/context/` before starting and a satori log to `.phase2s/satori/` after each attempt. Stops when tests are green.
- **`/consensus-plan`** — consensus-driven planning. Three sequential passes: Planner (concrete implementation plan), Architect (structural review, flags CONCERN/SUGGESTION), Critic (adversarial objections). Loops back to Planner with objections as constraints (max 3 loops). Outputs APPROVED / APPROVED WITH CHANGES / REVISE.
- **Agent tier routing** — skills (and callers) can now specify `model: fast` or `model: smart` in SKILL.md frontmatter. The agent resolves aliases to `config.fast_model` / `config.smart_model`, falling back to `config.model` if not configured. Set via `PHASE2S_FAST_MODEL` / `PHASE2S_SMART_MODEL` env vars or `.phase2s.yaml`.
- **Underspecification gate** — when `requireSpecification: true` in config, short prompts without file paths are rejected with a warning. Override with `force:` prefix.
- **Satori mode in agent** — `agent.run()` now accepts `maxRetries`, `verifyCommand`, `verifyFn` (for testing), `preRun`, and `postRun` options. The satori loop injects failure output back into the conversation and calls postRun after each attempt.

### For contributors

- **`src/core/agent.ts`** — full rewrite. `run()` now accepts `AgentRunOptions` (backward compatible: old `(message, onDelta)` signature still works). Inner `runOnce()` extracted so `addUser()` stays in the outer `run()` — satori retries inject new failure messages, not re-add the original user message. `verifyFn?` in options enables test injection without a real shell.
- **`src/core/config.ts`** — added `fast_model`, `smart_model`, `verifyCommand` (default: `"npm test"`), `requireSpecification` (default: `false`). Env vars: `PHASE2S_FAST_MODEL`, `PHASE2S_SMART_MODEL`, `PHASE2S_VERIFY_COMMAND`.
- **`src/providers/types.ts`** — `ChatStreamOptions` interface added. `chatStream()` now accepts optional third arg `options?: ChatStreamOptions` with `model?` field.
- **`src/providers/openai.ts`** and **`src/providers/codex.ts`** — updated to accept and pass through `options?.model`.
- **`src/skills/types.ts`** — `model?` and `retries?` fields added to `Skill` interface.
- **`src/skills/loader.ts`** — `model` and `retries` frontmatter fields parsed and attached to skill objects.
- **2 new SKILL.md files** in `.phase2s/skills/` — satori, consensus-plan.
- **18 new tests** — config Sprint 8 (4), loader Sprint 8 (3), agent satori loop (7), built-in skills Sprint 8 (4). **175 tests total** (up from 157).
- **`UNDERSPEC_WORD_THRESHOLD = 15`** — named constant, not a magic number.
- **VERSION** — fixed from stale `"0.7.0"` to `"0.10.0"`.

## v0.9.0 — 2026-04-03

Sprint 7: 5 execution skills — workflows for the actual work of writing, debugging, cleaning, and documenting code. Two ported from oh-my-codex (`/deep-specify` from `$deep-interview`, `/slop-clean` from `$ai-slop-cleaner`), three original.

### What you can do now

- **`/debug`** — systematic debugging end-to-end. Reproduce the bug, isolate the smallest failing case, form root cause hypotheses, implement the fix, verify with tests. Different from `/investigate` (which traces root cause only) — `/debug` goes all the way to a verified fix. Saves a debug log to `.phase2s/debug/`.
- **`/tdd`** — test-driven development. Red (write failing tests) → Green (minimal implementation) → Refactor (clean up). Detects your test framework from `package.json`. Accepts a target file or behavior description. Reports coverage delta.
- **`/slop-clean`** — anti-slop refactor pass, ported from oh-my-codex's `$ai-slop-cleaner`. Five-smell taxonomy: dead code, duplication, needless abstraction, boundary violations, missing tests. Runs on git-changed files or a specified path. Baseline tests before any changes. One smell category at a time. Tests after each pass.
- **`/deep-specify`** — structured spec interview before coding, ported from oh-my-codex's `$deep-interview`. Identifies the 3-5 highest-risk ambiguities, asks Socratic questions one at a time, synthesizes answers into a spec with Intent / Boundaries / Non-goals / Constraints / Success criteria. Saves to `.phase2s/specs/`. Gates at the end with a pointer to `/plan` or `/autoplan`.
- **`/docs`** — inline documentation generation. Writes JSDoc/TSDoc into the code itself (not an explanation to you). Priority: public API first (full `@param`/`@returns`/`@throws`/`@example`), then complex logic inline comments, then interface field annotations, then module headers. Runs `tsc --noEmit` after to catch annotation errors.

### For contributors

- **5 new SKILL.md files** in `.phase2s/skills/` — debug, tdd, clean, deep-specify, docs.
- **OMX adaptation strategy** — `/deep-specify` and `/slop-clean` are ported from oh-my-codex with two changes: (1) OMX infrastructure dependencies removed (no MCP state, no tmux workers, no `.omx/` paths), (2) paths remapped to `.phase2s/`. The smell taxonomy and Socratic question protocol are preserved intact.
- **Artifact directories** — new skills persist to `.phase2s/debug/` and `.phase2s/specs/` (consistent with existing `.phase2s/sessions/`, `.phase2s/checkpoints/`).
- **6 new tests** in `test/skills/built-in-skills.test.ts` — covers all 5 new skills (name, description, trigger phrases, prompt content checks) plus a sanity check that total loaded skill count is >= 23. **157 tests total** (up from 151).
- **OMX infrastructure backlog** — the power features from oh-my-codex that require Phase2S core changes (agent tier routing, `$ralph` persistent execution, `$ralplan` consensus planning, tmux teams, MCP state server, notification gateway) are documented in TODOS.md Long-term section for a future infrastructure sprint.

## v0.8.0 — 2026-04-03

Sprint 6: 11 new skills ported from gstack, stripped of YC marketing, renamed where startup connotations didn't fit.

### What you can do now

- **`/retro`** — weekly engineering retrospective. Runs `git log` across the last 7 days, reports velocity (commits, LOC, fix ratio, test ratio), identifies patterns and churn, ends with one concrete improvement to focus on next week. Saves to `.phase2s/retro/`.
- **`/health`** — code quality dashboard. Auto-detects your tooling (tsc, vitest/jest, eslint, knip). Runs each check, scores on a 0–10 weighted rubric (tests 40%, types 25%, lint 20%, dead code 15%). Shows trend across last N runs. Persists to `.phase2s/health/history.jsonl`. Reports only — does not fix.
- **`/audit`** — multi-phase security scan. Covers: secrets in code and git history, dependency vulnerabilities (`npm audit`), input validation and injection paths, sandbox enforcement review, shell command safety, and session/persistence security. Each finding includes severity (CRIT/HIGH/MED/LOW), confidence (VERIFIED/UNVERIFIED), and an exploit scenario.
- **`/plan-review`** — engineering plan review. Six sections: scope validation, architecture critique, code quality, test coverage map (ASCII diagram of which paths are tested vs. not), performance flags, and one adversarial outside challenge. Ends with APPROVE / APPROVE WITH CHANGES / REVISE AND RESUBMIT.
- **`/scope-review`** — scope and ambition challenge. Four modes: Expand (what's the 10x version?), Hold (max rigor on stated scope), Reduce (strip to essentials), Challenge (adversarial). Distinct from `/plan-review` which focuses on implementation quality vs. this which focuses on whether you're solving the right problem at the right scale.
- **`/autoplan`** — orchestrates `/scope-review` + `/plan-review` sequentially with defined auto-decision principles: prefer completeness, fix blast radius, cleaner architecture wins, eliminate duplication, explicit over clever, bias toward action. Surfaces only taste decisions and user challenges at the end gate.
- **`/checkpoint`** — structured session state snapshot. Infers current state from git and conversation: branch, recent commits, decisions made, remaining work, next step. Saves to `.phase2s/checkpoints/YYYY-MM-DD-HH-MM.md`. Complements `--resume` (which restores the full conversation) with a human-readable summary.
- **`/careful`** — safety mode. Pauses before destructive shell commands (rm, git reset --hard, git push --force, DROP TABLE, docker rm, sudo) and asks for explicit confirmation. Safe commands (ls, git status, npm test) proceed without prompting.
- **`/freeze <dir>`** — restricts file edits to a single directory for the session. Ask the user which directory, then enforce it via model self-monitoring. Read operations unrestricted.
- **`/guard`** — combines `/careful` + `/freeze`. Full safety mode: destructive command confirmation AND directory-scoped edits. Single activation step.
- **`/unfreeze`** — clears the edit directory restriction set by `/freeze` or `/guard`.

### For contributors

- **11 new SKILL.md files** in `.phase2s/skills/` — retro, health, audit, plan-review, scope-review, autoplan, checkpoint, careful, freeze, guard, unfreeze. All follow the standard SKILL.md format (YAML frontmatter + prompt template).
- **Adaptation strategy** — skills are ported from gstack with two changes: (1) YC marketing content stripped (no Garry Tan persona, no YC application prompts, no garryslist.org essay links), (2) names with startup connotations renamed (cso → audit, plan-ceo-review → scope-review, plan-eng-review → plan-review).
- **Safety skills are prompt-only** — careful/freeze/guard/unfreeze enforce via model self-monitoring, not tool hooks. Phase2S's `allowDestructive: false` config provides shell-level enforcement underneath. This is documented as a soft constraint in each skill.
- **Artifact directories** — new skills persist to `.phase2s/retro/`, `.phase2s/health/`, `.phase2s/checkpoints/`, `.phase2s/security-reports/` (consistent with existing `.phase2s/sessions/`).
- **12 new tests** in `test/skills/built-in-skills.test.ts` — covers all 11 new skills (name, description, trigger phrases, prompt content) plus a sanity check that total loaded skill count is ≥ 18. **151 tests total** (up from 139).

## v0.7.0 — 2026-04-03

Sprint 5: security hardening, conversation persistence, and /diff skill.

### What you can do now

- **`phase2s --resume`** — picks up exactly where you left off. Every interactive turn is auto-saved to `.phase2s/sessions/<YYYY-MM-DD>.json`. Start a long debugging session, quit, come back the next day with `phase2s --resume` and the full conversation history is there.
- **`/diff` skill** — review uncommitted or last-commit changes with structured feedback. Say "what changed", "review this diff", or "check my diff". Gets you: what changed per file, why it probably changed, risk assessment, and test coverage gaps. Ends with a clear verdict (LOOKS GOOD / NEEDS REVIEW / RISKY).
- **Sandbox symlink fix** — `file_read` and `file_write` now use `realpath()` before the sandbox check. A symlink at `<project>/link -> /etc` would previously bypass the sandbox. Now it's blocked. Real files inside the project still work exactly as before.
- **Codex arg safety** — prompts starting with `--` are no longer misread by codex's own arg parser. The `"--"` end-of-flags separator is now inserted into the args array before the prompt.

### For contributors

- **`src/tools/sandbox.ts`** — new shared `assertInSandbox(filePath, cwd?)` helper. Uses `fs.realpath()` to follow symlinks before the sandbox check. Both `file-read` and `file-write` now call it instead of duplicating the `path.resolve()` check. ENOENT falls back to lexical resolve (safe for new files); other errors (dangling symlinks) block without leaking the absolute path.
- **`Conversation.save(path)` + `Conversation.load(path)`** — serialize/deserialize message history (including tool calls and tool results) to JSON. Parent directories are created automatically.
- **`AgentOptions.conversation?`** — inject an existing `Conversation` when constructing an `Agent`. Used by `--resume` to skip the fresh system prompt and load prior history. `agent.getConversation()` exposes the live conversation for post-run saves.
- **`cleanupTempDirs()` in codex.ts** — extracted into a named function, registered on `exit`, `SIGTERM`, and `SIGINT`. Previously SIGTERM would bypass cleanup and leak prompt data in `/tmp`.
- **139 tests total** — 26 new tests: 22 across `test/tools/sandbox.test.ts`, `test/core/conversation-persistence.test.ts`, `test/skills/diff-skill.test.ts`, and `test/providers/codex-hardening.test.ts`, plus 4 more added during adversarial review hardening (parent-symlink attack, session prompt injection, role validation, message object validation). All 113 existing tests continue to pass.

---

## v0.6.0 — 2026-04-03

Sprint 4: streaming output and npm publish.

### What you can do now

- **Responses stream in real time** — words appear in your terminal as the model thinks. No spinner. No wait. Works in both the interactive REPL and `phase2s run "..."` one-shot mode. Set `OPENAI_API_KEY` and `PHASE2S_PROVIDER=openai-api` to see it.
- **`PHASE2S_ALLOW_DESTRUCTIVE=true` env var** — unlock destructive shell commands (`rm -rf`, `sudo`, etc.) without a `.phase2s.yaml` file. Useful for scripted or automated use cases where you control the environment.
- **`npm install -g phase2s` is ready** — bin entry verified, `files` field set for a clean 36.5kB tarball. Publish workflow fires automatically on `git tag v0.6.0 && git push origin v0.6.0` once `NPM_TOKEN` is set in repo secrets.

### For contributors

- **Breaking interface change: `chat()` → `chatStream()`** — `Provider` now requires `chatStream(): AsyncIterable<ProviderEvent>`. Both providers updated. Old `chat()` is gone.
- **OpenAI streaming** — `chatStream()` uses `stream: true`. Tool call argument fragments accumulate per-index across chunks before emitting a `tool_calls` event. See `src/providers/openai.ts` for the accumulation logic.
- **Codex passthrough wrapper** — `chatStream()` wraps private `_chat()` in a single-event generator. Same batch UX as before, new interface. Real Codex JSONL streaming deferred.
- **`onDelta?: (text: string) => void` callback on `Agent.run()`** — fires with each text chunk. The CLI uses it to stream to stdout; skills call `run()` without it for batch semantics.
- **Test migration** — all 8 agent integration tests migrated from non-streaming stubs to `makeStreamingFakeClient`. 6 new tests added (delta ordering, fragment accumulation, event sequence, Codex wrapper, env var truthy variants). 113 tests total.
- **GitHub Actions publish workflow** — `.github/workflows/publish.yml` triggers on `v*` tag push, runs `npm test` before build. Requires `NPM_TOKEN` repo secret.
- **Post-review hardening** — `ora` removed from production deps (was unused after streaming); sparse `toolCallAccum` guard added (non-contiguous tool call indices from OpenAI are now filtered before emitting); `PHASE2S_ALLOW_DESTRUCTIVE` now accepts `"1"` and `"yes"` in addition to `"true"`.

---

## v0.5.0 — 2026-04-03

Sprint 3: integration tests, shell hardening, and live API verification.

### What you can do now

- **`openai-api` provider works** — run `PHASE2S_PROVIDER=openai-api phase2s run "..."` with your OpenAI key and get real tool-calling responses. The full loop (user → LLM → tool call → execute → final answer) has been tested live against the API.
- **Shell safety on by default** — destructive commands (`rm -rf`, `sudo`, `curl | sh`, `git push --force`, etc.) are blocked unless you explicitly set `allowDestructive: true` in `.phase2s.yaml`. Safe to share configs with your team without accidentally blowing up something.
- **Truncation handling** — if the LLM hits its context limit mid-response, you get the partial text back with a clear `[Note: response was truncated]` notice instead of silence. Content-filtered responses return `[Response blocked by content filter]`.

### For contributors

- **8 agent integration tests** in `test/core/agent.test.ts` — covers no-tool-call, single tool call, multi-turn, tool error recovery, max turns sentinel, finish_reason length, finish_reason content_filter, and malformed JSON arguments. 107 tests total.
- **`OpenAIClientLike` interface** exported from `src/providers/openai.ts` — typed DI stub for tests, no real API key needed in CI.
- **`AgentOptions.provider?: Provider`** — inject a pre-constructed provider in tests without touching config.
- **`createShellTool(allowDestructive)` factory** in `src/tools/shell.ts` — backward-compat `shellTool` export unchanged, all 10 existing non-destructive shell tests unaffected.
- **`allowDestructive: boolean` (default `false`)** added to config schema in `src/core/config.ts`.

---

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
