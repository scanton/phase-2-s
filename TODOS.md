# Phase2S — TODO List

> **North star:** Phase2S is to Codex CLI what gstack is to Claude Code.
> A personal AI programming harness with a skill system, multi-model support,
> and enough structure to grow into a team-sized tool.

---

## Sprint 32-34 (done) — MiniMax Provider, README Refresh (v1.11.0)

- [x] MiniMax provider: composition over OpenAI, `https://api.minimax.io/v1/`, MiniMax-M2.5 default
- [x] README refresh: providers table, features in depth (lint, dry-run, progress, report, state server, MCP report, browser, --system, verifyCommand)
- [x] Bear mascot: attempted in v1.10.0, removed in v1.11.0 (ASCII art didn't meet quality bar)
- [x] 595 tests

---

## Sprint 36 (next) — Parallel Dark Factory: Test Coverage + Resume Hardening

> **Priority: P0 — ship immediately after v1.12.0 lands.**
> These gaps were identified in the v1.12.0 pre-landing review. All are integration-test shaped (real temp git repos, not unit mocks).

- [ ] **Test `executeParallel()` behavior** — timeout rejection → `status: "failed"`, level failure halts subsequent levels, `completedLevels` skipped on resume, `unstash` called even when a level throws (test the `finally` block). Currently zero behavior tests for the function that runs 90% of parallel execution.
- [ ] **Test `mergeWorktree()` conflict path** — create two branches modifying the same file, verify conflict detection returns `status: "conflict"` with correct `conflictFiles`, verify `git merge --abort` restores clean state.
- [ ] **Test `stashIfDirty` / `unstash`** — dirty working tree → stash created → `unstash` pops it. Clean tree → no stash created.
- [ ] **Test `buildLevelContext()` success path** — real temp repo with two commits; verify returned string contains changed filenames, "N files changed" prose, and truncates correctly at 4096 bytes.
- [ ] **Test `updateWorkerPane` / `updateStatusBar`** — inactive dashboard (no-op), text with double-quote characters (escape verification).
- [ ] **Harden `--resume` with parallel** — `makeWorktreeSlug` uses `Math.random()`, so existing worktrees can't be located by name on resume. Populate `LevelWorkerState.worktreePath` when creating worktrees so resume can detect and reuse them. Consider deterministic slug (specHash + index) as an option.

---

## Sprint 37 (P2 backlog — after v1.13.0)

- [ ] **Migrate `level-context.test.ts` edge-case tests to use `makeTempRepo()`** — The
  existing edge-case tests (bad hash, bad dir, HEAD..HEAD) run against the live project repo.
  After `test/goal/helpers.ts` ships in v1.13.0, migrate them to use isolated temp repos for
  better test hygiene. Low priority — tests pass fine as-is. Depends on: helpers.ts (v1.13.0).

---

## Sprint 35 (done) — Parallel Dark Factory (v1.12.0)

| Metric | Value |
|--------|-------|
| Version | v1.12.0 |
| Tests | 646 (+51) |

- [x] **Parallel execution** — `phase2s goal --parallel` or auto-detected. Git worktrees, max 3 workers.
- [x] **Dependency graph** — Hybrid (explicit `files:` + regex). Kahn's algorithm, cycle detection.
- [x] **Level context injection** — Git diff summary for parallel workers.
- [x] **Merge strategy** — Sequential merge at level boundaries. Same-file conflict halts.
- [x] **tmux dashboard** — Optional `--dashboard` flag.
- [x] **Auto-detect parallel** — 3+ independent subtasks triggers parallel mode.
- [x] **Dry-run visualization** — Execution level diagram.
- [x] **Parallel run reports** — Per-level timing, wall-clock savings.
- [x] **Resume** — Level-based resume with `--resume --parallel`.
- [x] **Doctor** — tmux + git worktree checks.
- [x] **Spec format** — `**Files:**` annotation for explicit dependency declaration.

---

## Sprint 31 (done) — Spec Linting + Gemini Provider (v1.8.0)

| Metric | Value |
|--------|-------|
| Version | v1.8.0 |
| Tests | 580 (+21) |

- [x] **`phase2s lint <spec.md>`** — validate a 5-pillar spec before running it. Catches 4 structural errors (missing title, empty problem statement, no decomposition, no acceptance criteria) and 2 advisory warnings (default evalCommand, subtask missing success criteria). Exits 0 when spec is runnable (warnings OK), exits 1 on errors. Pure function `lintSpec()` exported for testing. `runLint()` handles IO. 8 tests in `test/cli/lint.test.ts`.
- [x] **Gemini provider** — `src/providers/gemini.ts`. Composition over `OpenAIProvider` using Google's OpenAI-compatible API endpoint (`generativelanguage.googleapis.com/v1beta/openai/`). No new SDK dependency. `GEMINI_API_KEY` env var or `geminiApiKey` in config. Optional `geminiBaseUrl` override. Default model: `gemini-2.0-flash`. 5 tests in `test/providers/gemini.test.ts`.
- [x] **Config schema updates** — `geminiApiKey`, `geminiBaseUrl` fields in `src/core/config.ts`. Provider enum extended to include `"gemini"`. Default model logic extended.
- [x] **`phase2s init` wizard updates** — Gemini added as provider option 6 ("Google Gemini (free tier available — gemini-2.0-flash by default)"). `checkPrerequisites` validates `AIza` prefix. Prompts for API key with link to aistudio.google.com/apikey. `printNextSteps` shows next steps for Gemini. Non-interactive `validProviders` includes "gemini". 4 tests added to `test/cli/init.test.ts`.
- [x] **`phase2s doctor` updates** — Gemini case added to `checkAuth()`. "gemini" added to `knownProviders` in `checkConfigFile()`. 2 tests added to `test/cli/doctor.test.ts`.
- [x] **Shell completion** — `lint` added to bash COMPREPLY list and zsh subcommands array.
- [x] **Docs** — `docs/configuration.md` (Gemini provider comment, `geminiApiKey`/`geminiBaseUrl` fields, env var table, provider enum), `docs/getting-started.md` (Option F: Google Gemini, version bump to v1.8.0), `docs/advanced.md` (Option F section, streaming note updated), `CHANGELOG.md` v1.8.0 entry.

---

## Sprint 30 (done) — Self-Update + Skills Search (v1.7.0)

| Metric | Value |
|--------|-------|
| Version | v1.7.0 |
| Tests | 559 (+19) |

- [x] **`phase2s upgrade`** — checks npm registry for the latest version, prompts to run `npm install -g @scanton/phase2s`, live output during install. `--check` flag for CI non-interactive mode. Graceful failure when registry is unreachable. Pure functions: `parseVersion()`, `isUpdateAvailable()`, `checkLatestVersion()`. 12 tests in `test/cli/upgrade.test.ts`.
- [x] **`phase2s skills [query]`** — optional positional search argument on the `skills` command. Case-insensitive substring match on skill name and description. Empty query = list all (backward compatible). "No skills match" message when query returns zero results. Works with `--json` for scripting. 7 tests added to `test/cli/skills-output.test.ts`.
- [x] **Shell completion** — `upgrade` added to bash COMPREPLY list and zsh subcommands array.

---

## Sprint 29 (done) — Installation Health Check + OpenRouter Provider (v1.6.0)

| Metric | Value |
|--------|-------|
| Version | v1.6.0 |
| Tests | 540 (+24) |

- [x] **`phase2s doctor`** — new diagnostic command. 5 pure check functions: `checkNodeVersion` (>= 20), `checkProviderBinary` (codex/ollama binary in PATH), `checkAuth` (API key for all 5 providers), `checkConfigFile` (valid YAML, known provider), `checkWorkDir` (.phase2s/ writable). `runDoctor()` loads existing config, runs checks, filters N/A, prints chalk ✓/✗ with fix instructions. 16 tests in `test/cli/doctor.test.ts`.
- [x] **OpenRouter provider** — `src/providers/openrouter.ts`. Composition over `OpenAIProvider` with pre-configured OpenAI client pointing at `https://openrouter.ai/api/v1`. HTTP-Referer and X-Title headers injected for attribution. Model names use provider-prefixed slugs (`openai/gpt-4o`, `anthropic/claude-3-5-sonnet`). `OPENROUTER_API_KEY` env var or `openrouterApiKey` in config. Optional `openrouterBaseUrl` override. Default model: `openai/gpt-4o`. 6 tests in `test/providers/openrouter.test.ts`.
- [x] **Config schema updates** — `openrouterApiKey`, `openrouterBaseUrl` fields in `src/core/config.ts`. Provider enum updated. Default model logic extended.
- [x] **`phase2s init` wizard updates** — OpenRouter added as provider option (5). `checkPrerequisites` validates `sk-or-` prefix. Prompts for API key. `printNextSteps` links to `openrouter.ai/models`.
- [x] **Shell completion** — `doctor` added to both bash COMPREPLY list and zsh subcommands array.
- [x] **Docs** — `docs/configuration.md` (OpenRouter provider comments, `openrouterApiKey`/`openrouterBaseUrl` fields, env var table), `docs/getting-started.md` (Option E: OpenRouter + `phase2s doctor` health check section), `CHANGELOG.md` v1.6.0 entry.

---

## Sprint 28 (done) — Notification Channels + Glob Tool Filtering (v1.5.0)

| Metric | Value |
|--------|-------|
| Version | v1.5.0 |
| Tests | 516 (+13) |

- [x] **Discord notifications** — `notify.discord` in `.phase2s.yaml` or `PHASE2S_DISCORD_WEBHOOK`. Rich embeds with green/red color. `sendDiscordNotification()` in `src/core/notify.ts`.
- [x] **Microsoft Teams notifications** — `notify.teams` in `.phase2s.yaml` or `PHASE2S_TEAMS_WEBHOOK`. MessageCard format with `themeColor`. `sendTeamsNotification()` in `src/core/notify.ts`.
- [x] **`phase2s init` Discord + Teams prompts** — interactive wizard now asks for Discord and Teams webhook URLs. `--discord-webhook` and `--teams-webhook` flags for CI mode.
- [x] **Glob/wildcard in `tools` and `deny`** — `*` wildcard in tool allow/deny lists. `file_*` matches `file_read` and `file_write`. No-match patterns warn at startup. `matchesPattern()` in `src/tools/registry.ts`.
- [x] **Backlog additions** — Gemini, MiniMax, OpenRouter, Telegram providers added to long-term backlog.

---

## Sprint 27 (done) — Onboarding Wizard (v1.4.0)

| Metric | Value |
|--------|-------|
| Version | v1.4.0 |
| Tests | 503 (+20) |

- [x] **`phase2s init`** — interactive setup wizard: provider selection (1–4), API key prompt, optional fast/smart model tiers, optional Slack webhook. Writes `.phase2s.yaml` with comments. Validates prerequisites and prints tailored next steps.
- [x] **Non-interactive mode** — `--non-interactive` flag with `--provider`, `--api-key`, `--fast-model`, `--smart-model`, `--slack-webhook` for CI scripting.
- [x] **Existing config pre-fill** — `readExistingConfig()` reads current `.phase2s.yaml` so re-running `init` defaults to current values. Safe to run multiple times.
- [x] **Prerequisite validation** — checks `codex` binary (codex-cli), `sk-` prefix (openai-api), `sk-ant-` prefix (anthropic), `ollama` binary (ollama). Reports warnings but always writes config.
- [x] **`src/cli/init.ts`** — pure functions (`formatConfig`, `checkPrerequisites`, `readExistingConfig`) exported for testing; IO functions (`promptConfig`, `runInit`) handle all side effects.
- [x] **`test/cli/init.test.ts`** — 20 tests: `formatConfig` (all 4 providers, model tiers, Slack), `checkPrerequisites` (key format, missing binary, missing env var), `readExistingConfig` (parse, missing, invalid YAML, non-object).
- [x] **`docs/getting-started.md`** — `phase2s init` added as Step 2 of Option A setup flow.

---

## Sprint 26 (done) — Notification Gateway + Run Report Viewer (v1.3.0)

| Metric | Value |
|--------|-------|
| Version | v1.3.0 |
| Tests | 483 (+30) |

- [x] **`phase2s goal --notify`** — sends macOS system notification via `osascript` (no deps) and/or Slack webhook (`PHASE2S_SLACK_WEBHOOK` env var or `notify.slack` in `.phase2s.yaml`) when a dark factory run completes. Both channels are fail-safe: errors go to stderr, never block the run. `notify` also available as `phase2s__goal` MCP parameter.
- [x] **`phase2s report <log.jsonl>`** — chalk-colored run summary: spec filename, per-attempt sub-task timeline with durations (✓/✗), criteria verdicts, total time. Reads the JSONL run log written by Sprint 25's RunLogger.
- [x] **`phase2s__report` MCP tool** — same report viewer as an MCP tool. Claude Code calls it with the `runLogPath` returned by `phase2s__goal` to see exactly what happened without reading raw JSONL.
- [x] **`GoalResult.durationMs`** — total wall-clock run duration included in all goal results. Used by notifications and available to MCP callers.
- [x] **`notify` config block** — `.phase2s.yaml` accepts `notify: { mac: true, slack: "..." }`.
- [x] **`src/core/notify.ts`** — `sendNotification()`, `buildNotifyPayload()`, `formatDurationMs()`. Platform-agnostic, fail-safe.
- [x] **`src/cli/report.ts`** — `parseRunLog()`, `buildRunReport()`, `formatRunReport()`. Pure functions — no side effects in parser, chalk in display layer only.

---

## Sprint 25 (done) — Dark Factory as MCP Tool + Run Logs + Pre-Execution Adversarial Review (v1.2.0)

| Metric | Value |
|--------|-------|
| Version | v1.2.0 |
| Tests | 453 (+20) |

- [x] **`phase2s__goal` MCP tool** — Claude Code can trigger the dark factory directly. Returns run summary + absolute JSONL run log path. Long-running by design (20+ min, MCP spec has no timeout).
- [x] **Structured JSONL run logs** — `RunLogger` class writes `<specDir>/.phase2s/runs/<timestamp>-<hash>.jsonl`. Events: goal_started, subtask_started/completed, eval_started/completed, criteria_checked, plan_review_completed, goal_completed. Written incrementally, survives process death.
- [x] **Pre-execution adversarial review** — `--review-before-run` CLI flag + `reviewBeforeRun` MCP option. Fresh Agent instance (no context contamination). CHALLENGED/NEEDS_CLARIFICATION halts; APPROVED proceeds. `buildAdversarialPrompt()` injects spec decomposition + criteria as the plan.
- [x] **`runGoal()` throws Error** — no longer calls `process.exit()`. CLI entry point wraps in try/catch. `GoalResult` extended: `runLogPath`, `summary`, `challenged?`, `challengeResponse?`.
- [x] **Docs updated** — `docs/dark-factory.md` (--review-before-run, run logs), `docs/claude-code.md` (phase2s__goal section + tool table).

---

## Sprint 24 (done) — MCP State Server + Dark Factory Resumability (v1.1.0)

| Metric | Value |
|--------|-------|
| Version | v1.1.0 |
| Tests | 433 (+34) |

- [x] **`phase2s goal --resume`** — resume from last completed sub-task after interruption. State keyed by SHA-256 of spec content. Atomic writes (tmp→rename).
- [x] **MCP state tools** — `phase2s__state_write`, `phase2s__state_read`, `phase2s__state_clear`. Raw key-value store, JSON-serializable values, `.phase2s/state/<key>.json`.
- [x] **`src/core/state.ts`** — pure state functions. GoalState (typed) + raw KV (for MCP tools). Shared by goal.ts and server.ts.

---

## Sprint 23 (done) — QA Pass + Security Fixes + npm v1.0.0 (v1.0.0)

| Metric | Value |
|--------|-------|
| Version | v1.0.0 |
| Tests | 399 |

- [x] Security: CVE fixes in `@actions/core`, `@actions/github`, `undici`
- [x] Docs: version strings corrected, `PHASE2S_BROWSER` env var documented
- [x] `package.json`: npm page fields (repository, homepage, bugs, author, keywords)
- [x] Stability contract documented in CHANGELOG

---

## Sprint 22 (done) — Real Codex JSONL Streaming (v0.26.0)

| Metric | Value |
|--------|-------|
| Version | v0.26.0 |
| Tests | 390 |

- [x] **Real Codex streaming** — JSONL stdout parsing from codex subprocess. Step-by-step feedback for multi-step tasks. No more waiting for full completion before output appears.

---

## Sprint 21 (done) — Dark Factory: phase2s goal (v0.25.0)

| Metric | Value |
|--------|-------|
| Version | v0.25.0 |
| Tests | ~360 |

- [x] **`phase2s goal <spec.md>`** — dark factory: spec in, feature out. Breaks spec into sub-tasks, runs each through satori, checks acceptance criteria, retries with failure analysis.
- [x] **5-pillar spec format** — `/deep-specify` output feeds directly into `phase2s goal`. Parser is lenient (missing sections handled gracefully).
- [x] **`spec-parser.ts`** — pure parser for the 5-pillar spec format.

---

## Sprint 20 (done) — GitHub Action (v0.24.0)

| Metric | Value |
|--------|-------|
| Version | v0.24.0 |
| Tests | 295 |

- [x] **`uses: scanton/phase2s@v1` GitHub Action** — run Phase2S skills in CI. Requires API key (not ChatGPT subscription — OAuth can't run in CI).

---

## Sprint 16 (done) — Scripting, Clean Install, Accurate Tests (v0.20.0)

| Metric | Value |
|--------|-------|
| Version | v0.20.0 |
| Tests | 295 (+4) |

- [x] `phase2s skills --json` — machine-readable skill list (name, description, model tier, inputs with types)
- [x] `node-domexception` deprecation fixed — `overrides.formdata-node: ^6.0.0` in package.json
- [x] Vitest worktree exclusion — `vitest.config.ts` with `exclude: ['.claude/**']`, test count accurate at 295
- [x] `/plan` disk output — saves to `.phase2s/plans/YYYY-MM-DD-HH-MM-<slug>.md` with timestamp
- [x] `VERSION` reads from `package.json` at runtime via `createRequire` (no more hardcoded constant)

---

## Sprint 15 (done) — Model Tier Dogfooding + One-Shot Routing + Typed Inputs (v0.18.0–v0.19.1)

| Metric | Target |
|--------|--------|
| Version | v0.18.0 |
| Skills | 29 (28 with model tier declared) |
| Tests | 279 (+12) |

_Plan reviewed by `/autoplan` (CEO + Eng + DX). Approved 2026-04-04._

### Deferred from autoplan review

- [x] **TODO-1: CLI completion hints** — `phase2s completion bash` and `phase2s completion zsh` output shell completion scripts. Completes subcommands and dynamically fetches skill names via `phase2s skills --json` for the `run` subcommand. Add `eval "$(phase2s completion bash)"` to `~/.bashrc`.
- [x] **TODO-2: `phase2s skills --json` output** — shipped v0.20.0
- [x] **TODO-3: `--dry-run` flag for one-shot mode** — shipped v0.19.0
- [x] **TODO-4: Typed inputs REPL rendering** — shipped v0.19.0
- [x] **TODO-5: Inline model tier in `phase2s skills` output** — shipped v0.19.0

---

## Sprint 13 (done) — Interactive Skills + Plan Output + Tool Control (v0.16.0)

| Metric | Value |
|--------|-------|
| Version | v0.16.0 |
| Skills | 29 (updated templates) |
| Tests | 249 |

_Plan reviewed by `/plan-eng-review` + outside voice (Claude subagent)._

### Multi-turn skills — skill inputs protocol

Skills declare structured inputs in SKILL.md frontmatter. Phase2S substitutes declared inputs only — `{{name}}` tokens NOT in `skill.inputs` pass through unchanged to the model (no escape convention needed, no false positives on existing templates like `/explain`).

**SKILL.md frontmatter addition:**
```yaml
inputs:
  feature:
    prompt: "What feature do you want to plan?"
  scope:
    prompt: "Any scope constraints or non-goals?"
```

**Body uses normal placeholders:** `Plan the {{feature}} feature. Constraints: {{scope}}.`

**Design decisions (eng review):**
- `{{name}}` only substituted if `name` is in `skill.inputs` — existing `{{target}}` in `/explain` is safe
- Substitution is v1 string-only; MCP input types beyond string are a known v1 limitation (add to backlog)
- One-shot `phase2s run` mode is unaffected — skill routing only exists in REPL

- [x] `src/skills/template.ts` (new) — `substituteInputs(template, values, inputs)` only replaces keys declared in `inputs`; `getInputKeys(inputs)` returns declared key names. Tested in isolation.
- [x] `src/skills/types.ts` — add `inputs?: Record<string, { prompt: string }>` to `Skill` interface
- [x] `src/skills/loader.ts` — parse `inputs:` from YAML frontmatter; store in `Skill`
- [x] `src/cli/index.ts` — in skill invocation block: for each key in `skill.inputs`, if `{{key}}` appears in template, prompt user via `nextLine()`, collect answers, call `substituteInputs()` before running
- [x] `src/mcp/server.ts` — in `skillToTool`: add each `skill.inputs[name]` as a named optional string parameter in `inputSchema.properties` with `prompt` as description. In `handleRequest` > `tools/call`: extract input values from `params.arguments`, call `substituteInputs()` before building `fullPrompt`
- [x] Pre-implementation: grep bundled skills for existing `inputs:` key to confirm no collision
- [x] Tests in `test/skills/template.test.ts` (new): basic substitution, missing key passes through, same placeholder twice, empty values, extra values in map ignored, declared-but-absent in template is harmless — target: +6 tests
- [x] Tests in `test/skills/loader.test.ts`: parses `inputs` with prompt strings, malformed inputs ignored — target: +2 tests
- [x] Tests in `test/mcp/server.test.ts`: `skillToTool` adds input fields to schema, skill without inputs unchanged, `handleRequest` substitutes input values, missing input value leaves placeholder — target: +4 tests
- [x] Dogfood: update `/plan` SKILL.md to use `inputs:` for feature name (see `/plan` section below)

### `/plan` skill improvement

- [x] Update `.phase2s/skills/plan/SKILL.md`: shipped Sprint 16/17. Saves to `.phase2s/plans/YYYY-MM-DD-HH-MM-<slug>.md`. Asks "Append Phase 1 tasks to TODOS.md?" and appends if confirmed.

### Configurable tool allow/deny list

**Design decisions (eng review):**
- `deny` always overrides `allow` (explicit security policy — documented in code comment)
- Warn on unrecognized tool names: `console.warn("Warning: unknown tool 'shel' in deny list")` — non-fatal but visible
- v1: exact name matching only; glob/prefix patterns (`file_*`) deferred to backlog
- Method name: `ToolRegistry.allowed(allow?, deny?)` returning a new `ToolRegistry`

- [x] `src/core/config.ts` — add `tools?: string[]` and `deny?: string[]` to configSchema (zod optional arrays)
- [x] `src/tools/registry.ts` — add `allowed(allow?: string[], deny?: string[]): ToolRegistry` method; deny overrides allow; warn on unrecognized names
- [x] `src/core/agent.ts` — apply `this.tools = this.tools.allowed(config.tools, config.deny)` in constructor
- [x] Tests in `test/core/config.test.ts`: parses `tools:`, parses `deny:` — target: +2 tests
- [x] Tests in `test/tools/registry.test.ts`: allow-list filters, deny-list filters, deny overrides allow, no filter returns all, unknown name emits warning — target: +5 tests
- [x] Tests in `test/core/agent.test.ts`: agent uses filtered registry when config has `tools`/`deny` — target: +1 test
- [x] Docs: add `tools:` / `deny:` YAML example with deny-overrides note in `docs/configuration.md`

### NOT in scope (Sprint 13)
- Real Codex JSONL streaming (spike needed — format undocumented)
- MCP input types beyond string (boolean, enum) — v1 is string-only
- Glob/prefix matching in allow/deny (`tools: ["file_*"]`) — v1 is exact names only
- Anthropic Claude provider (shipped Sprint 14)

---

## Sprint 12 (done) — MCP Hot-Reload + Session Persistence (v0.15.0)

| Metric | Value |
|--------|-------|
| Version | v0.15.0 |
| Skills | 29 |
| Tests | 221 |

- [x] **MCP skills hot-reload** — `fs.watch()` on `.phase2s/skills/` with 80ms debounce. Sends `notifications/tools/list_changed` when new skills are added during a session. `capabilities: { tools: { listChanged: true } }` in initialize response.
- [x] **MCP session persistence** — `Map<string, Conversation>` keyed by skill name, scoped to MCP subprocess. Multi-turn skills (`/satori`, `/consensus-plan`) now maintain conversation history across calls within the same Claude Code session.
- [x] **`/review` adversarial extension** — After delivering standard review, offers opt-in adversarial challenge (VERDICT / STRONGEST_CONCERN / OBJECTIONS / APPROVE_IF). Fast path unchanged; adversarial is opt-in.

---

## Sprint 11 (done) — npm Publish + Bundled Skills (v0.13.x–v0.14.0)

| Metric | Value |
|--------|-------|
| Version | v0.14.0 |
| Skills | 29 |
| Tests | 221 |

- [x] **`/land-and-deploy` skill** — 7-step workflow: check state, push, open/discover PR via `gh`, wait for CI (`gh pr checks --watch`), merge + delete branch, post-merge confirmation.
- [x] **npm publish** — Published as `@scanton/phase2s` (unscoped `phase2s` blocked by npm similarity check). Token: Granular Access Token with 2FA bypass. Workflow triggers on `v*` tags.
- [x] **Bundled skills** — Added `bundledSkillsDir()` using `import.meta.url` in `loader.ts` so skills ship inside the npm package. Added `.phase2s/` to `package.json` files array.
- [x] **Renamed to `@scanton/phase2s`** — All docs, install commands updated.

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

- [x] **MCP skills reload** — Done in Sprint 12 (v0.15.0). `fs.watch()` + `notifications/tools/list_changed`.
- [x] **MCP tool calls stateless** — Done in Sprint 12 (v0.15.0). `Map<string, Conversation>` per-session persistence.

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

- [x] **MCP state server** — shipped Sprint 24 (v1.1.0). `phase2s__state_write/read/clear`.
- [x] **Parallel teams** — shipped Sprint 35 (v1.12.0). Spec-aware leveled parallelism.
- [x] **Notification gateway** — shipped Sprint 26 (v1.3.0). macOS + Slack. `--notify` flag, `PHASE2S_SLACK_WEBHOOK` env var.
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
- [x] **npm publish** — Published as `@scanton/phase2s` (unscoped `phase2s` blocked by npm similarity check against `phaser`). Token: Granular Access Token with 2FA bypass. Workflow: `.github/workflows/publish.yml` triggers on `v*` tags. Install: `npm install -g @scanton/phase2s`. v0.13.1.

---

## Near-term (v0.3.0) — OpenAI Provider + Polish

- [x] **Complete openai-api provider** — wire tool calling end-to-end ← done Sprint 3
  - Handle `finish_reason: "length"` and `"content_filter"` gracefully
  - Test with `file_read`, `shell`, and `glob` tools via direct API
- [x] **Model-per-skill config** — fully implemented. `model: fast | smart | gpt-4o` (any literal) in SKILL.md frontmatter. `agent.ts:resolveModel()` maps "fast"→`config.fast_model`, "smart"→`config.smart_model`, anything else passes through as a literal model ID. 28 of 29 built-in skills declare a tier (Sprint 15). No code changes needed.
- [x] **Codex arg injection hardening** — `"--"` separator added to args array before prompt. Done Sprint 5. v0.7.0.
- [x] **Shell tool hardening** — blocks destructive commands by default ← done Sprint 3
  - `allowDestructive: false` default; set `true` in `.phase2s.yaml` to unlock
- [x] **npm publish** — Done. See Sprint 4 section. Published as `@scanton/phase2s` at v0.13.1.

---

## Medium-term (v0.4.0–v0.5.0) — Power Features

- [x] **Streaming output** — done in Sprint 4 (v0.6.0). OpenAI streams; Codex passthrough wrapper. Real Codex JSONL streaming still deferred (format undocumented).
- [x] **Conversation persistence** — done Sprint 5. `Conversation.save/load`, `--resume` flag, auto-save after each turn. v0.7.0.
- [x] **Multi-turn skills** — shipped Sprint 17 (v0.21.0). `{{ASK: question}}` inline prompts in SKILL.md. REPL prompts interactively; one-shot strips + warns; MCP strips + surfaces PHASE2S_NOTE degradation signal.
- [x] **`/plan` skill improvement** — shipped Sprint 16/17. Saves to `.phase2s/plans/YYYY-MM-DD-HH-MM-<slug>.md` via `shell` + `file_write`. After writing, asks "Append Phase 1 tasks to TODOS.md?" and appends if confirmed. Structured checklist output format with phases and verify steps.
- [x] **`/diff` skill** — done Sprint 5. Structured diff review with LOOKS GOOD / NEEDS REVIEW / RISKY verdict. v0.7.0.
- [x] **Configurable tool allow/deny list** — fully implemented since Sprint 13. `tools:` and `deny:` in `.phase2s.yaml`. `ToolRegistry.allowed()` enforces deny-overrides-allow. Warns on unknown names at startup. Documented in `docs/configuration.md` (Sprint 18).
- [x] **Real Codex JSONL streaming** — Shipped Sprint 22 (v0.26.0). Step-by-step feedback for multi-step tasks.
- [x] **`glob` deprecation fix** — Fixed Sprint 15. Upgraded `glob` from `^11.0.0` to `^13.0.0` in package.json.
- [x] **Anthropic Claude provider** — `src/providers/anthropic.ts` shipped in Sprint 14. `provider: anthropic` in `.phase2s.yaml`. Uses `@anthropic-ai/sdk@0.82.0`. All 29 skills work on Claude 3.5 Sonnet.
- [x] **Skill inputs v2: typed parameters** — Add optional `type: "boolean" | "enum" | "number"` and `enum:` to inputs schema so MCP tool parameters can be typed. Shipping in Sprint 15 (v0.18.0).
- [x] **Skill inputs v2: glob/prefix matching in allow/deny** — shipped Sprint 28 (v1.5.0). `tools: ["file_*"]` pattern matching via `matchesPattern()` in registry.ts. `*` wildcard supported in both `tools` and `deny`. No-match patterns warn at startup.
- [x] **Skill inputs v2: one-shot skill routing** — `phase2s run "/plan build auth"` detects skill prefix and routes through skill system. Shipping in Sprint 15 (v0.18.0).

---

## Long-term (v1.0+) — Multi-model + Ecosystem

### OMX Infrastructure (from oh-my-codex analysis, Sprint 7 backlog)

These are the power features from oh-my-codex that go beyond SKILL.md. They require infrastructure changes to Phase2S's core.

- [x] **Agent tier routing** — Shipped Sprint 15 (v0.18.0). `fast_model`/`smart_model` in `.phase2s.yaml`. `model: fast | smart` in SKILL.md frontmatter. 28 of 29 built-in skills declare a tier.
- [x] **Persistent execution loop** (`$ralph` pattern) — shipped as `phase2s goal` (Sprint 21) + satori inner retry loop. `phase2s__goal` MCP tool (Sprint 25) makes it callable from Claude Code.
- [x] **Consensus planning** (`$ralplan` pattern) — shipped as `/consensus-plan` skill (Sprint 13). `phase2s__consensus_plan` MCP tool available.
- [x] **Parallel team execution** (`$team` pattern) — shipped Sprint 35 (v1.12.0). Spec-aware leveled parallelism with git worktrees, dependency graph, merge strategy, optional tmux dashboard.
- [x] **MCP state server** — shipped Sprint 24 (v1.1.0). `phase2s__state_write/read/clear` in `src/core/state.ts` + `src/mcp/server.ts`.
- [x] **Notification gateway** — shipped Sprint 26 (v1.3.0). macOS system notification + Slack webhook on dark factory completion. `--notify` CLI flag, `notify` MCP param, `notify:` config block.
- [x] **Context snapshots** — implemented. `writeContextSnapshot()` in `cli/index.ts` writes `.phase2s/context/{ts}-{slug}.md` before each satori run (branch, recent commits, diff stat, verify command, task). The "mandatory for all prompts" framing was over-broad — satori is the right scope (long-running tasks where partial completion is the risk).
- [x] **`/skill` meta-skill** — done in Sprint 10. Guided interview (3 questions) generates a SKILL.md file via file-write. Creates `.phase2s/skills/<name>/SKILL.md` from within a session.
- [x] **Underspecification gate** — implemented. `isUnderspecified()` in `cli/index.ts` checks prompt length (&lt;15 words, no file path). Gated on `requireSpecification: true` in `.phase2s.yaml`. User overrides with `force:` prefix. Documented in `docs/configuration.md` under "Safety mode for shared repos".

### General

- [x] **Multi-model routing** — Shipped Sprint 15 (v0.18.0). `fast_model`/`smart_model` config. Skills declare `model: fast | smart | <literal>`. `Agent.resolveModel()` maps tiers to configured models.
- [x] **MCP server integration** — shipped Sprint 12. `phase2s mcp` exposes all 29 skills + state tools + goal tool as Claude Code tools. Configured via `.claude/settings.json`.
- [ ] **oh-my-codex-style multi-agent** — route subtasks to specialized sub-agents
  - Orchestrator assigns tasks; specialist agents (coder, reviewer, tester) execute
  - Each specialist has its own tool set and system prompt
- [x] **Persistent memory across sessions** — done in Sprint 10. `loadLearnings()` + `formatLearningsForPrompt()` in `src/core/memory.ts`. Injected into system prompt via `AgentOptions.learnings`. CLI loads automatically from `.phase2s/memory/learnings.jsonl`. `/remember` skill writes new learnings.
- [x] **Browser tool** — shipped Sprint 19 (v0.23.0). Headless Playwright browser. Used by `/qa` skill and available as a tool in the agent loop.
- [x] **More provider support** — Anthropic + Ollama (Sprint 14), OpenRouter (Sprint 29), Gemini (Sprint 31).
  - Provider interface already abstracted; just implement `chatStream()`
- [x] **GitHub Actions integration** — shipped Sprint 20. `uses: scanton/phase2s@v1`. Requires API key for CI use.
- [x] **Self-update** — shipped Sprint 30 (v1.7.0). `phase2s upgrade` checks npm registry, prompts to install. `--check` for CI.
- [x] **Skills search** — shipped Sprint 30 (v1.7.0). `phase2s skills <query>` filters by name/description.
- [x] **`phase2s lint <spec.md>`** — shipped Sprint 31 (v1.8.0). Validates 5-pillar spec structure before dark factory run.
- [x] **Gemini provider** — shipped Sprint 31 (v1.8.0). `provider: gemini`, `GEMINI_API_KEY`, OpenAI-compatible endpoint, no new SDK dependency.
- [x] **`phase2s goal --dry-run`** — shipped Sprint 32 (v1.9.0). Parses and prints the spec decomposition tree without any LLM calls. Exits in under a second. 3 tests.
- [x] **Live dark factory progress** — shipped Sprint 32 (v1.9.0). `[1/3] Running: Sub-task name` (cyan) and `Done in Xs` per sub-task. Retries shown in yellow. Makes long runs observable.
- [x] **`phase2s lint` >8 sub-task warning** — shipped Sprint 32 (v1.9.0). Large specs are unreliable; lint warns and suggests breaking into smaller specs. 1 test.
- [x] **`phase2s lint` evalCommand PATH check** — shipped Sprint 32 (v1.9.0). Warns immediately if the eval binary (e.g. `pytest`) is not on PATH. Skipped for default `npm test`. 3 tests.
- [x] **MiniMax provider** — shipped Sprint 32-34 (v1.11.0). Composition over OpenAI, `api.minimax.io/v1/`, MiniMax-M2.5 default.
- [ ] **Multi-provider parallel workers** — Per-subtask model routing for parallel execution. Different workers use different providers based on task complexity. Depends on Sprint 35 parallel infrastructure.
- [ ] **VS Code extension** — run skills from the editor sidebar
  - `/review` on current file, `/investigate` on selected error, `/plan` for a feature
- [ ] **Telegram notifications** — `notify.telegram.token` + `notify.telegram.chatId`. Requires BotFather setup + `getUpdates` to find chat ID. Consider `phase2s init --telegram-setup` helper that calls `getUpdates` and prints the chat ID automatically.

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
