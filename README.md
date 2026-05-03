# Phase2S

Three things Phase2S does that most AI coding tools don't:

1. **Runs on your ChatGPT subscription** — If you pay for ChatGPT Plus or Pro, you can use that same subscription to power a full coding assistant in your terminal. No API key, no per-token billing. The $20/month you're already paying starts pulling its weight.

2. **Gives Claude Code a second opinion** — If you use Claude Code as your daily driver, Phase2S plugs in as an MCP server and gives Claude a tool to call that runs your plan through GPT from a completely different model with completely different training. Before Claude executes anything big, it gets challenged by a second AI that has no stake in agreeing with it.

3. **Executes specs autonomously** — Write a spec describing what you want built and how you'll know it's done. Run `phase2s goal your-spec.md`. Phase2S breaks it into sub-tasks, implements each one, runs your tests, checks whether the results match your criteria, and retries with failure analysis if anything falls short. You come back when it's done.

---

## Quick install

Requires [Node.js](https://nodejs.org) >= 20.

**If you have ChatGPT Plus or Pro (recommended)**

```bash
npm install -g @openai/codex @scanton/phase2s
codex auth
phase2s
```

`codex auth` opens a browser window and logs into your ChatGPT account. You do it once. After that, `phase2s` uses your subscription automatically — no API keys, no credits to manage.

**If you have an OpenAI API key**

```bash
npm install -g @scanton/phase2s
export OPENAI_API_KEY=sk-your-key-here
export PHASE2S_PROVIDER=openai-api
phase2s
```

**If you have an Anthropic API key**

```bash
npm install -g @scanton/phase2s
export ANTHROPIC_API_KEY=sk-ant-your-key-here
export PHASE2S_PROVIDER=anthropic
phase2s
```

**If you want the best of both: ChatGPT subscription for coding + Ollama for semantic memory (recommended combo)**

```bash
npm install -g @openai/codex @scanton/phase2s
codex auth
ollama pull gemma4:latest
```

```yaml
# .phase2s.yaml
provider: codex-cli
ollamaBaseUrl: http://localhost:11434/v1   # enables semantic learnings injection
```

With this setup, Phase2S uses your ChatGPT subscription for all coding work and uses a local Ollama model to find the most relevant learnings to inject into each session — no API billing, no data leaving your machine for the memory layer.

**If you want to run everything locally (free, private, no internet)**

```bash
npm install -g @scanton/phase2s
ollama pull gemma4:latest
export PHASE2S_PROVIDER=ollama
phase2s
```

---

## Shell integration (ZSH)

After installing, run `phase2s setup` once to enable the `: <prompt>` shorthand from any directory in your terminal — no REPL required.

```bash
phase2s setup

# Activate in the current shell (or open a new terminal tab):
source ~/.phase2s/phase2s.plugin.zsh

# Then from any directory:
: fix the null check in auth.ts
: what does this codebase do?
: explain the retry logic in agent.ts
p2 suggest "find large log files"
```

`phase2s setup` copies the ZSH plugin to `~/.phase2s/` and adds a `source` line to your `~/.zshrc`. It's idempotent — safe to re-run after npm upgrades. Use `phase2s setup --dry-run` to preview what it would do.

---

## Feature 1: Your ChatGPT subscription, in your terminal

Most people who pay for ChatGPT Plus use it by opening a browser tab and typing. Phase2S turns it into a programmable coding tool you can use from the command line, from scripts, and from inside Claude Code.

```
you > /review src/core/auth.ts

  CRIT: session.destroy() is called without await on line 83.
        If it rejects (Redis timeout, etc.), the error is silently dropped
        and the response goes out before the session is actually cleared.

  WARN: The JWT expiry check on line 47 uses Date.now() directly.
        Clock skew between your server and the token issuer can cause
        valid tokens to fail. Use a small leeway (±30s) instead.

  NIT:  The error message on line 91 says "auth failed" but should say
        "session_expired" to match the error codes in api-errors.ts.
```

```
you > /satori add rate limiting to the API

-- Attempt 1 --
[creates src/utils/rate-limiter.ts]
[creates src/middleware/rate-limit.ts]
[registers middleware in app.ts]
[writes tests in test/middleware/rate-limit.test.ts]
npm test: FAIL — bucket not clearing on window expiry

-- Attempt 2 --
[fixes resetAt logic in RateLimiter.check()]
npm test: PASS (23 tests)

Done in 2 attempts.
```

The 29 built-in skills cover the full development loop: specify, plan, implement, test, review, debug, ship, deploy. All of them run on your subscription.

[Full skill list →](docs/skills.md)

---

## Feature 2: Claude Code + Phase2S adversarial review

If you use Claude Code, here's the problem: one model reviewing its own work has blind spots. Claude agrees with Claude. The same training data, the same biases, the same failure modes.

Phase2S solves this by plugging into Claude Code as an MCP server. When Claude is about to execute a plan, it can call Phase2S — which runs the same plan through GPT using your ChatGPT subscription — and get back a structured challenge:

```
VERDICT: CHALLENGED
STRONGEST_CONCERN: The token bucket resets per-request rather than per-window.
OBJECTIONS:
1. RateLimiter.check() increments the counter and checks it in the same call.
   When the window expires, the bucket resets on the next request — meaning
   a client can always make exactly one request immediately after the window
   closes, even if they were throttled. The reset should happen on a fixed
   schedule, not lazily on first request.
2. The middleware is registered after the auth middleware in app.ts line 34.
   Unauthenticated requests bypass rate limiting entirely.
APPROVE_IF: Fix the window reset logic and move middleware before auth.
```

Claude gets specific, falsifiable objections from a model that wasn't involved in writing the plan. You see the verdict. You decide whether to proceed.

**Setup takes about 2 minutes.** [Step-by-step guide →](docs/claude-code.md)

---

## Feature 3: The dark factory

Write a spec. Run one command. Come back when it's done.

`phase2s goal` reads your spec, breaks it into sub-tasks, implements each one through the `/satori` skill (which runs implement → test → retry until green), runs your eval command, checks whether your acceptance criteria actually passed, and if they didn't — analyzes what broke, figures out which sub-tasks need to be re-run, and tries again with that failure context.

It keeps going until all criteria pass or it runs out of attempts.

When your spec has 3 or more independent sub-tasks, Phase2S runs them in parallel inside git worktrees — each worker gets its own isolated branch, and Phase2S merges everything back at level boundaries. A 3-sub-task spec that used to take 30 minutes can finish in 12.

```bash
# Write the spec interactively
phase2s
you > /deep-specify add pagination to the search endpoint

# Execute it autonomously
phase2s goal .phase2s/specs/2026-04-04-11-00-pagination.md
```

```
Goal executor: Pagination for search endpoint
Sub-tasks: 3 | Eval: npm test | Max attempts: 3

=== Attempt 1/3 ===
Running sub-task: Cursor-based pagination logic
[satori: implement → test → retry until green]

Running sub-task: API response format update
[satori: implement → test → retry until green]

Running sub-task: Frontend page controls
[satori: implement → test → retry until green]

Running evaluation: npm test

Acceptance criteria:
  ✗ Returns correct next_cursor on paginated results
  ✓ Returns 20 items per page by default
  ✓ next_cursor is null on last page

Retrying 1 sub-task(s): Cursor-based pagination logic

=== Attempt 2/3 ===
Running sub-task: Cursor-based pagination logic
[satori: implement → test → retry until green]

Running evaluation: npm test

Acceptance criteria:
  ✓ Returns correct next_cursor on paginated results
  ✓ Returns 20 items per page by default
  ✓ next_cursor is null on last page

✓ All acceptance criteria met after 2 attempt(s).
```

This uses your ChatGPT subscription for all the implementation work. No API key needed.

[Full dark factory guide →](docs/dark-factory.md)

---

## Meet the A-team: Apollo, Athena, Ares

Phase2S ships three named agent personas, each with a distinct job and a hard-wired tool set. Switch mid-session without losing your conversation history.

```
you > :ask  (or: apollo)     — Switch to Apollo: read-only Q&A, fast model
you > :plan (or: athena)     — Switch to Athena: planning assistant, writes to plans/
you > :build (or: ares)      — Switch to Ares: full access, default agent
you > :agents                — List all available agents with aliases and tool counts
you > :compact               — Compact conversation history into an LLM summary (frees context)
you > :goal specs/auth.md    — Run a goal spec from inside the REPL (no session exit)
you > :dump                  — Export this session as a markdown transcript
you > :dump html             — Export as a self-contained HTML page (dark mode included)
you > :help                  — Show all REPL commands with descriptions
```

| Agent | Alias | Model | Tools | Best for |
|-------|-------|-------|-------|----------|
| **Apollo** | `:ask` | fast | glob, grep, file_read, browser | Questions, code exploration, "how does X work?" |
| **Athena** | `:plan` | smart | read tools + `plans_write` | Design docs, implementation plans, architecture notes |
| **Ares** | `:build` | smart | all tools | Writing code, running tests, shipping features |

Tool enforcement is hard. Apollo cannot write files — not because the system prompt says so, but because `file_write` is literally not in its registry. Athena can only write inside `plans/`. Project overrides in `.phase2s/agents/` can narrow a built-in's tool list but never expand it.

```bash
# Apollo answers a question about your codebase
you > :ask
you > how does the session locking work?

# Athena writes a plan (saved to plans/ automatically)
you > :plan
you > design the rate limiting system before we build it

# Ares ships it
you > :build
you > implement the plan in plans/rate-limiting.md

# Custom agents: add .phase2s/agents/scout.md to your project
you > :agent scout
```

Active agent is saved on `--resume` — pick up where you left off with the same persona active.

---

## @file and @url attachment

Type `@path/to/file.ts` or `@https://...` anywhere in a REPL prompt — or in a `phase2s run "..."` one-shot command — to inline content as context before your message is sent to the model.

**File attachment:**

```
you > @src/core/auth.ts why does this throw when session is null?
```

Phase2S reads the file, wraps it in a `<file path="...">` block, and prepends it to your message. The model sees the full source without you having to copy-paste.

**URL attachment:**

```
you > @https://docs.example.com/api summarize the authentication section
```

Phase2S fetches the URL and extracts clean article text using Mozilla Readability (the same engine Firefox Reader View uses). HTML navigation, ads, and boilerplate are stripped. Non-HTML responses (JSON, plain text) are inlined as-is. Requests time out after 10 seconds.

**Tab completion** — press Tab while typing an `@fragment` and Phase2S completes it against filenames in your project. Directories get a trailing `/` so you can keep drilling down.

**Size limits** — files and URL responses over 20 KB are rejected with an error. Files 201–500 lines are inlined with a size warning. Files over 500 lines are truncated to 200 lines and marked `[truncated]`.

**Safety** — file path traversal is rejected; paths that resolve outside the project sandbox are blocked and the `@token` is left in your prompt so you can see what failed. URL requests block private IP ranges (RFC 1918, loopback, link-local, AWS metadata endpoint) before any network call, and re-check redirect destinations to prevent redirect-to-private-IP attacks.

You can mix files and URLs in one prompt:

```
you > @src/core/agent.ts @https://platform.openai.com/docs/api-reference does our implementation match the spec?
```

---

## All 29 skills

```
you > /review src/auth.ts        — code review: CRIT / WARN / NIT
you > /diff                      — review all uncommitted changes
you > /satori add pagination     — implement + test + retry until green
you > /deep-specify add OAuth    — spec interview → 5-pillar spec file
you > /consensus-plan add OAuth  — planner + architect + critic passes
you > /debug logout fails        — reproduce, isolate, fix, verify
you > /investigate why 500s      — evidence trail to root cause
you > /health                    — code quality score (tests, types, lint)
you > /audit                     — secrets scan, dependency CVEs, injection
you > /ship                      — diff review + commit message
you > /land-and-deploy           — push, PR, CI wait, merge
you > /remember                  — save a project convention to memory
you > /retro                     — weekly velocity and pattern analysis
```

```bash
phase2s skills        # full list with model tier badges
phase2s skills --json # machine-readable for scripts
```

[Skills reference →](docs/skills.md)

---

## Docs

- [Getting started](docs/getting-started.md) — first install, first session, all four provider options
- [Named agents](docs/agents.md) — Apollo, Athena, Ares, custom agents, override-restrict policy
- [Dark factory](docs/dark-factory.md) — write a spec, run `phase2s goal`, get a feature
- [Claude Code integration](docs/claude-code.md) — MCP setup, adversarial review, CLAUDE.md routing rules
- [Skills reference](docs/skills.md) — all 29 skills with examples
- [Workflows](docs/workflows.md) — real development sessions end to end
- [Memory and persistence](docs/memory.md) — session resume, context compaction (`:compact`), session branching and forking, `/remember`, what gets saved
- [Writing custom skills](docs/writing-skills.md) — create your own `/commands`
- [GitHub Action](docs/github-action.md) — `uses: scanton/phase2s@v1` for CI (requires API key)
- [Advanced](docs/advanced.md) — streaming, model routing, tool allow/deny
- [Configuration](docs/configuration.md) — `.phase2s.yaml` and environment variables
- [E2E eval framework](docs/eval.md) — `npm run eval`, adding eval cases, structural vs quality criteria, deploy gate
- [Contributing](CONTRIBUTING.md) — session storage internals, lock correctness, NFS caveats

---

## Providers

| Provider | Auth | Default Model | Setup |
|----------|------|---------------|-------|
| ChatGPT subscription | Browser login | gpt-5.4 | `codex auth` (one time) |
| OpenAI API | `OPENAI_API_KEY` | gpt-4o | `phase2s provider login` |
| Anthropic | `ANTHROPIC_API_KEY` | claude-3-5-sonnet | `phase2s provider login` |
| Ollama | Local (no auth) | gemma4:latest | `ollama pull gemma4:latest` |
| OpenRouter | `OPENROUTER_API_KEY` | openai/gpt-4o | `phase2s provider login` |
| Google Gemini | `GEMINI_API_KEY` | gemini-2.0-flash | `phase2s provider login` |
| MiniMax | `MINIMAX_API_KEY` | MiniMax-M2.5 | `phase2s provider login` |

---

## Features in Depth

### Dark Factory Tools

**Start from a template:**

```bash
# See the 6 bundled spec templates
phase2s template list

# Fill in placeholders and write a spec in one step
phase2s template use auth
phase2s template use api
phase2s template use bug
```

`phase2s template list` shows all bundled templates with their descriptions. `phase2s template use <name>` runs a short wizard (3-4 questions), fills in placeholders like `{{resource_name}}` and `{{test_command}}`, and writes the spec to `.phase2s/specs/` — ready to lint and run. Templates: `auth`, `api`, `refactor`, `test`, `cli`, `bug`.

**Validate before you run:**

```bash
# Check your spec for structural issues before a 20-minute agent run
phase2s lint specs/add-rate-limiting.md

# Only run if lint passes
phase2s lint specs/add-rate-limiting.md && phase2s goal specs/add-rate-limiting.md
```

`phase2s lint` catches missing titles, empty problem statements, specs with no sub-tasks, missing acceptance criteria, and warns about specs with 8+ sub-tasks or default eval commands.

**Preview the plan without running it:**

```bash
# See the decomposition tree without making any LLM calls
phase2s goal specs/add-rate-limiting.md --dry-run
```

Shows the parsed spec title, sub-task list, acceptance criteria, and eval command. No tokens spent.

**Live progress during execution:**

```
[1/3] Running: Cursor-based pagination logic (42s)
[2/3] Running: API response format update (18s)
[3/3] Running: Frontend page controls (31s)
```

Real-time subtask progress with elapsed time per sub-task, so you know where the agent is.

**Review completed runs:**

```bash
# Chalk-colored timeline of a dark factory run
phase2s report .phase2s/runs/2026-04-05-goal-abc123.jsonl
```

Shows sub-task timeline, attempt counts, criteria verdicts, and total duration.

### MCP Integration

Phase2S runs as an MCP server, exposing all skills as Claude Code tools. [Setup guide →](docs/claude-code.md)

Beyond skills, the MCP server provides:

**State server** — durable key-value store for Claude Code workflows:

```
# Claude Code can persist state across tool calls
phase2s__state_write({ key: "deploy_status", value: "in_progress" })
phase2s__state_read({ key: "deploy_status" })  # → "in_progress"
phase2s__state_clear({ key: "deploy_status" })
```

**Run report via MCP** — Claude Code can summarize dark factory results:

```
phase2s__report({ runLogPath: ".phase2s/runs/2026-04-05-goal-abc123.jsonl" })
```

### Semantic learnings (Ollama)

Phase2S injects your saved learnings into every session. Out of the box, it injects the most recent ones. With a local Ollama instance running, it finds the most *relevant* ones instead — using embedding similarity to match your learnings to the current task.

When `ollamaBaseUrl` is set, Phase2S:
1. Embeds your query text using the local Ollama `/api/embed` endpoint
2. Scores every learning against that embedding (cosine similarity)
3. Injects the top-K matches instead of the newest-K

The index is built on first use and updated incrementally — only changed or new learnings are re-embedded. The index lives at `.phase2s/search-index.jsonl` inside your project.

**Best setup: ChatGPT subscription + Ollama**

Use your ChatGPT subscription for all implementation work. Run Ollama locally for the semantic memory layer. No API billing, no data leaving your machine.

```bash
# 1. Install + authenticate once
npm install -g @openai/codex @scanton/phase2s
codex auth

# 2. Pull a local embed model
ollama pull gemma4:latest

# 3. Configure
cat > .phase2s.yaml << 'EOF'
provider: codex-cli
ollamaBaseUrl: http://localhost:11434/v1
EOF

phase2s
```

With this config, `/satori`, `/consensus-plan`, and `phase2s goal` all get the learnings most relevant to the current task — not just the ones you saved most recently.

To use a separate, lighter model just for embeddings:

```yaml
# .phase2s.yaml
provider: codex-cli
ollamaBaseUrl: http://localhost:11434/v1
ollamaEmbedModel: nomic-embed-text  # dedicated embed model (faster, smaller)
```

When `ollamaEmbedModel` is set, the main model handles chat and the embed model handles indexing — you get the full `gemma4` quality for chat without the embedding overhead.

**Fallback behavior** — if Ollama is down, the model is unreachable, or no query text is available (e.g., REPL startup before your first message), Phase2S falls back to the previous behavior: inject the most recent learnings up to the 2000-character limit.

---

### Semantic Codebase Search (Ollama)

Index your entire codebase and search it by meaning, not just keywords.

```bash
# Index (or re-index) your codebase
phase2s sync

# Search by concept
phase2s search "rate limiting middleware"
phase2s search "session persistence"
phase2s search --top 10 "authentication flow"
```

`phase2s sync` discovers all git-tracked source files (via `git ls-files` — respects all `.gitignore` sources), embeds each file using the configured Ollama embed model, and writes an incremental vector index to `.phase2s/code-index.jsonl`. Unchanged files (same content hash + same model) are skipped — re-runs are fast.

`phase2s search` embeds your query, scores every indexed file by cosine similarity, and returns the top matches with path, score, and a one-line snippet:

```
Top 5 matches for "rate limiting middleware":

1. src/providers/backoff.ts  (0.91)
   export const MAX_RATE_LIMIT_RETRIES = 5;

2. src/cli/index.ts  (0.87)
   export async function startRepl(config: Config): Promise<void>

3. src/core/agent.ts  (0.84)
   export class Agent {
```

**The index is separate from the learnings index.** `.phase2s/search-index.jsonl` is your learnings memory; `.phase2s/code-index.jsonl` is your codebase map. They use the same Ollama embed infrastructure but GC and sync independently.

Requires `ollamaBaseUrl` to be set in `.phase2s.yaml`:

```yaml
ollamaBaseUrl: http://localhost:11434/v1
ollamaEmbedModel: nomic-embed-text  # optional; defaults to nomic-embed-text:latest
```

`phase2s doctor` checks for a missing code index and tells you to run `phase2s sync`.

---

### AI Commit Messages

```bash
# Generate a commit message from staged changes
git add src/auth.ts
phase2s commit

# Preview the proposed message without committing
phase2s commit --preview

# Non-interactive for CI — commits immediately, fails fast on detected secrets
phase2s commit --auto
```

`phase2s commit` reads the staged diff, asks the fast model to write a Conventional Commits message (`<type>(<scope>): <subject>`), and walks you through accept / edit / cancel. The edit path opens `$EDITOR` if configured, or falls back to a readline prompt.

The secrets scanner runs before the diff leaves your machine. If it finds AWS keys, OpenAI or Anthropic keys, GitHub tokens, or Slack tokens in the staged changes, it warns and asks whether to continue. In `--auto` mode it fails hard instead of prompting.

From inside the REPL, `:commit` does the same thing without breaking your session.

**For teams**

Check a `.phase2s.yaml` into your repo. Everyone gets consistent Conventional Commits format without a style guide argument:

```yaml
# .phase2s.yaml
commit:
  format: conventional   # <type>(<scope>): <subject>
```

For CI, use `--auto` with a direct API provider (ChatGPT subscription requires browser auth, which doesn't work in CI). Set `PHASE2S_PROVIDER=openai-api` and `OPENAI_API_KEY`, then:

```yaml
# .github/workflows/ci.yml
- name: Commit generated files
  run: |
    git add generated/
    phase2s commit --auto
  env:
    PHASE2S_PROVIDER: openai-api
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

Use `--preview` in PR workflows to inspect proposed messages without committing — useful for audit logs or comment bots.

---

### Tools and Configuration

**AGENTS.md — project-level conventions:**

Drop a file named `AGENTS.md` in your project root (or `~/.phase2s/AGENTS.md` for global conventions). Phase2S reads it and injects the contents into the system prompt automatically — in the REPL, in one-shot mode (`phase2s run "..."`), and in the MCP server. Good for house rules: preferred libraries, commit message style, things the model should never do.

```
# AGENTS.md
Always use pnpm, not npm.
Write tests before implementation (TDD).
Never commit directly to main.
```

[Full injection modes and MCP restart note →](docs/configuration.md#agentsmd)

**Custom system prompt:**

```bash
# Append a custom instruction to every agent session
phase2s --system "Always prefer Python for scripting tasks"
```

**Custom verification command** — configure what `/satori` runs to check your work:

```yaml
# .phase2s.yaml
verifyCommand: pytest tests/ -x  # or: go test ./... or: npm test
```

**Headless browser** — enable for the `/qa` skill to test web apps:

```yaml
# .phase2s.yaml
browser: true  # requires playwright installed
```

---

## Roadmap

- [x] Codex CLI provider (ChatGPT subscription, no API key required)
- [x] 29 built-in skills across 6 categories
- [x] File sandbox: tools reject paths outside project directory, including symlink escapes
- [x] 1,851 tests covering all tools, core modules, agent integration, goal executor, state server, run logs, MCP goal tool, notification gateway, run report viewer, onboarding wizard, glob tool filtering, OpenRouter provider, Gemini provider, MiniMax provider, installation health checks, self-update, skills search, spec linting, dark factory dry-run, lint PATH checks, parallel execution, dependency graph, worktree lifecycle, tmux dashboard, level context injection, parallel executor behavior, merge conflict detection, stash/unstash lifecycle, shared integration test harness, spec eval judge, multi-agent orchestrator, live re-planning, Telegram notification channel, spec template library, session branching DAG, bash shell integration, secrets scanning, AI-generated commit messages, session index/locking/DAG integrity, session lock hardening (PID-suffixed tmp files, SIGKILL recovery, symlink escape guard), replan agent (hallucination guard, tail-slice eval, empty tool registry), parallel goal retry loop, onDelta newline injection, rate-limit resilience (typed RateLimitError, rate_limited ProviderEvent, auto-backoff across all 7 providers), compaction rate-limit propagation, orchestrator rate-limit propagation, orchestrator sibling cancellation, @file attachment (REPL + one-shot), @url attachment with SSRF protection, `:goal` REPL command with reentrancy guard, `throwOnRateLimit`, and `handleRunGoalCase` extraction, `:dump`/`:dump html` conversation export, `:help` REPL command reference, `marked` v18 HTML rendering + ranked Tab completions, BFS `@file` Tab traversal, atomic compaction backup, sandbox execFileSync migration + TOCTOU guard, plans_write symlink escape guard, `phase2s provider` subcommand with 9 tests, semantic learnings injection via Ollama embeddings (embeddings, vector index, memory retrieval, ordering), and semantic codebase search (code-index, sync, search CLI, snippet extraction, staleness detection, embed resilience)
- [x] CI: runs `npm test` on every push and PR
- [x] OpenAI API provider with live tool calling
- [x] Anthropic API provider — Claude 3.5 Sonnet and family
- [x] Ollama provider — local models, offline, no API keys
- [x] Streaming output
- [x] Session persistence — auto-save + `--resume`
- [x] Model-per-skill routing — `fast_model` / `smart_model` tiers
- [x] Satori persistent execution — retry loop with shell verification
- [x] Consensus planning — planner + architect + critic
- [x] Claude Code MCP integration — all skills as Claude Code tools
- [x] `/adversarial` — cross-model adversarial review
- [x] Persistent memory — `/remember` + auto-inject into sessions
- [x] `/skill` — create new skills from inside Phase2S
- [x] `/land-and-deploy` — push, PR, CI wait, merge
- [x] Model tier badges in `phase2s skills` output
- [x] `--dry-run` for skill routing preview
- [x] Typed input hints in REPL
- [x] `phase2s skills --json`
- [x] Shell completion — `eval "$(phase2s completion bash)"`
- [x] Tool allow/deny in `.phase2s.yaml`
- [x] Headless browser tool via Playwright
- [x] GitHub Action — `uses: scanton/phase2s@v1`
- [x] `phase2s goal <spec.md>` — dark factory: spec in, feature out
- [x] 5-pillar spec format — `/deep-specify` output feeds directly into `phase2s goal`
- [x] Real Codex streaming (JSONL stdout parsing) — step-by-step feedback for multi-step tasks
- [x] MCP state server — `state_read`/`state_write`/`state_clear` as Claude Code tools
- [x] `phase2s goal --resume` — dark factory continuity: resumes from last completed sub-task after interruption
- [x] `phase2s__goal` MCP tool — Claude Code can trigger the dark factory directly, no terminal needed
- [x] Structured JSONL run logs — per-sub-task observability at `.phase2s/runs/<timestamp>.jsonl`
- [x] `--review-before-run` — adversarial pre-execution review before the dark factory starts
- [x] Notification gateway — `phase2s goal --notify` sends macOS system notification + optional Slack webhook on completion
- [x] `phase2s report <log.jsonl>` — chalk-colored run summary: sub-task timeline, durations, criteria verdicts, total time
- [x] `phase2s__report` MCP tool — Claude Code can summarize a run log after triggering the dark factory
- [x] `phase2s init` — interactive onboarding wizard: provider choice, API key, model tiers, Slack/Discord/Teams webhooks, pre-fills from existing config
- [x] Discord + Microsoft Teams notification channels for dark factory runs (`--notify`)
- [x] Glob/wildcard patterns in `tools` and `deny` config (`file_*` matches `file_read` and `file_write`)
- [x] OpenRouter provider — 50+ models (GPT-4o, Claude, Gemini, Llama) under a single `OPENROUTER_API_KEY`
- [x] `phase2s doctor` — installation health check: Node version, provider binary, auth, config, working dir
- [x] `phase2s upgrade` — self-update: checks npm registry, prompts to install, `--check` for CI
- [x] `phase2s skills [query]` — filter the skill list by name or description (`phase2s skills security`)
- [x] Google Gemini provider — free tier, `gemini-2.0-flash` default, OpenAI-compatible endpoint, no new SDK dependency
- [x] `phase2s lint <spec.md>` — validate a spec before a dark factory run: catches structural errors before the 20-minute agent loop begins
- [x] `phase2s goal --dry-run` — parse and display the spec decomposition tree without making a single LLM call
- [x] Live dark factory progress: `[1/3] Running: Sub-task name` with elapsed time per sub-task
- [x] `phase2s lint`: >8 sub-task warning and evalCommand PATH check
- [x] MiniMax provider — MiniMax-M2.5 default, OpenAI-compatible endpoint, no new SDK dependency
- [x] Parallel dark factory execution — leveled parallelism via git worktrees, auto-detected on 3+ independent subtasks, `--parallel`/`--sequential`/`--workers N`/`--dashboard` flags, hybrid file-based dependency analysis, sequential merge with conflict halt, level context injection, parallel run reports
- [x] `--resume --parallel` hardened — deterministic worktree slugs (`specHash + index`), persisted worktree paths in state, resume correctly locates existing worktrees instead of recreating them
- [x] `phase2s judge <spec.md> --diff <file>` — spec eval judge: compares acceptance criteria against a git diff, produces a per-criterion coverage map and a 0-10 score. Exits 1 if score < 7 (CI integration). Also accepts diff via stdin: `git diff HEAD~1 | phase2s judge spec.md`
- [x] `phase2s goal --judge` — runs the spec eval judge automatically after each attempt, emits `eval_judged` event to the run log, and renders a JUDGE REPORT block in `phase2s report` output
- [x] P1 parallel executor fixes — timer leak in `executeWorker()` (clearTimeout in finally), stash pop correctness (named stash + pop by ref instead of always `stash@{0}`), concurrent worktree prune race (promise-chain mutex per repo)
- [x] Multi-agent orchestrator — `**Role:** architect|implementer|tester|reviewer` annotations in specs route subtasks to role-appropriate workers, each with a tailored system prompt. Architect workers emit a structured ````context-json` block that downstream workers receive in their system prompts. `--orchestrator` flag forces orchestrator mode on any spec. Auto-detected when role annotations are present.
- [x] Live re-planning — when a subtask fails, the orchestrator calls the LLM with a structured prompt describing the failure, remaining jobs, and architect context. The response (`DeltaResponse`) is validated and merged back; `buildLevels()` re-levels the revised plan. Backward contamination DFS flags completed ancestors whose outputs the failed job consumed (`suspectCount` in the run log). Path traversal protection on all LLM-generated job IDs.
- [x] Telegram notification channel — `sendTelegramNotification()` in `notify.ts`, configurable via `PHASE2S_TELEGRAM_BOT_TOKEN` + `PHASE2S_TELEGRAM_CHAT_ID` env vars or `notify.telegram` in `.phase2s.yaml`. `phase2s init --telegram-setup` wizard calls `getUpdates`, picks the most recent chat, and prints the ready-to-paste YAML snippet.
- [x] `model:` spec annotation for parallel workers — subtasks declare `model: fast`, `model: smart`, or a literal model name. `resolveSubtaskModel()` maps aliases to configured tiers and falls back to the outer `--model` flag.
- [x] `phase2s template list` / `phase2s template use <name>` — 6 bundled spec templates (`auth`, `api`, `bug`, `refactor`, `test`, `cli`). Short wizard fills in 3-4 placeholders, substitutes tokens in a single pass (no cascade injection), writes spec to `.phase2s/specs/`, and runs lint automatically.
- [x] `phase2s doctor` templates check — verifies bundled templates directory is present and non-empty
- [x] `phase2s conversations` / `:clone <uuid>` — DAG-shaped session storage. Browse all sessions with fzf (or plain table), fork any session into a new branch. Sessions stored as `{schemaVersion:2, meta:{id,parentId,branchName}, messages:[]}`. Migration from YYYY-MM-DD.json is automatic, resumable, and non-destructive (backup created before any rename).
- [x] Bash shell integration — `phase2s setup --bash` installs `~/.phase2s/phase2s-bash.sh` and sources it from `~/.bash_profile`. Provides the same `: <prompt>` shorthand and `p2` alias as the ZSH integration, plus bash tab completion. Fixes for `:clone` corruption and atomic SIGINT save.
- [x] Byte-aware context truncation — `level-context.ts` uses `Buffer.from(context,'utf8').subarray(0,limit).toString('utf8')` instead of `String.slice()`. Fixes silent byte overrun with emoji or CJK filenames.
- [x] `phase2s commit` — AI-generated commit messages from staged diffs. Interactive accept / edit / cancel flow. `--auto` for CI (non-interactive, fails fast on detected secrets). `--preview` for dry-run inspection. Secrets scanner warns before sending the diff to your LLM provider. `:commit` REPL shorthand for in-session use. Conventional Commits format configurable via `.phase2s.yaml`.
- [x] POSIX exclusive-create lock on `state.json` — `writeReplState` is now async and uses `{ flag: "wx" }` to prevent last-writer-wins races when multiple REPL instances run in parallel. Stale locks (>30 s) are removed automatically.
- [x] O(1) `conversations` listing via session index — `.phase2s/sessions/index.json` is maintained on every `saveSession`/`cloneSession` call. `phase2s conversations` reads a single file instead of scanning every session on disk. Falls back to a full rebuild if the index is missing or corrupt.
- [x] `phase2s doctor` DAG integrity check — scans all session files and reports any `parentId` references that point to a non-existent session (dangling branches after manual deletion).
- [x] Session lock hardening (v1.22.2) — `releasePosixLock` reads the PID before unlinking to close an ABA race (also guards against decimal/corrupt PID via `Number.isInteger`); `rebuildSessionIndex` holds `.index.lock` only for the O(1) `renameSync` (scan happens before lock acquisition to prevent lock starvation); `migrateAll` writes `process.pid` to its lock file and calls `releasePosixLock` in `finally` instead of bare `unlinkSync`; `listSessions` fast path and slow path both filter stale paths with `existsSync` before emitting results.
- [x] Lock correctness closure + doom-loop prevention (v1.22.3) — PID-suffixed tmp files in `writeReplState` and `cloneSession` prevent concurrent-write races on the same `.tmp` path; SIGKILL stale migration lock recovery via `process.kill(pid, 0)` liveness check (dead process → steal lock, no more manual `rm *.lock`); two-phase symlink escape guard in `migrateAllLocked` (lexical + `realpathSync`); `phase2s doctor` now checks Bash shell integration parity with ZSH; doom-loop reflection protocol replaces the one-liner retry prompt in `buildSatoriContext` (set `PHASE2S_DOOM_LOOP_REFLECTION=off` to revert).
- [x] `phase2s doctor --fix` — rebuild session index and run DAG integrity check with a single flag; exits 1 on failure so it can be used in scripts and setup automation.
- [x] `-C <path>` global flag — runs any Phase2S subcommand as if started in `<path>` via `process.chdir()` in a `preAction` hook. Useful for scripts and aliases that need to target a specific project directory without a `cd`.
- [x] `:re [high|low|default]` — REPL reasoning-effort switcher. Changes the active reasoning level mid-session without leaving the REPL. Applies to normal turns only; skills keep their declared model tier.
- [x] Tool error reflection — when a tool call fails on attempt 1 of a satori run, a structured 3-question reflection prompt is injected before the retry to help the model self-correct. Set `PHASE2S_TOOL_ERROR_REFLECTION=off` to disable.
- [x] Bash `:()` limitation docs — `phase2s setup --bash` now prints a warning about `${VAR:=default}` expansion conflicts; the same explanation is documented in `docs/getting-started.md`.
- [x] Named agents (Apollo / Athena / Ares) — three built-in personas with hard-wired tool registries. Apollo (`:ask`, fast, read-only), Athena (`:plan`, smart, writes only to `plans/`), Ares (`:build`, smart, full access). Switch mid-session with `:ask`, `:plan`, `:build`, or `:agent <id>`. Override-restrict policy prevents project configs from expanding a built-in's tool list. Resume persistence saves the active agent across sessions. 1,191 tests.
- [x] CLI decomposition — `src/cli/index.ts` refactored: model resolution extracted to `src/cli/model-resolver.ts` (`resolveReasoningModel` / `resolveAgentModel`), colon-command dispatch extracted to `src/cli/colon-commands.ts` (`handleColonCommand` returning a `ColonAction` discriminated union). Both modules are pure functions with no side effects, fully unit-tested. Exhaustiveness guard in the REPL switch catches future `ColonAction` variants at compile time. 1,233 tests.
- [x] MCP server decomposition — `src/mcp/server.ts` split into `tools.ts` (descriptors + types), `watcher.ts` (hot-reload with debounce), `handler.ts` (JSON-RPC dispatch), and a slim barrel `server.ts`. Session conversations persist across tool calls within a server lifetime — multi-turn skills like `/satori` and `/consensus-plan` resume where they left off instead of starting fresh each call. Config loaded once at startup (not per-request). MCP crash guard returns JSON-RPC -32603 on internal errors instead of killing the server. 1,265 tests.
- [x] `phase2s --sandbox <name>` — Isolated REPL session in a fresh git worktree (`sandbox/<name>` branch, `.worktrees/sandbox-<name>` directory). Four-state detection: resume if healthy, prune and recreate if git entry is stale, recover from orphaned directories, or create fresh. On exit, prompts to merge back or preserve. Uncommitted work warning with second confirmation before merge cleanup prevents silent data loss.
- [x] `phase2s sandboxes` — List all active sandbox worktrees with name, path, and short commit hash. Prints `(none)` when empty. The "ls" for `--sandbox`.
- [x] Cooperative SIGINT cancellation — Ctrl-C during an active provider call now cancels the in-flight HTTP request (SIGTERM for Codex, AbortSignal for SDK-based providers) instead of waiting for completion. Abort errors are suppressed cleanly. AbortSignal threaded through `agent.run()` → `chatStream()` across all 7 providers.
- [x] MCP underscore skill name fix — Skills with native underscores in their names (e.g. `my_skill`) previously caused `-32601 Tool not found`. Fixed by storing `_skillName` on the tool descriptor to survive the hyphen→underscore round-trip. 1,286 tests.
- [x] `phase2s --sandbox` non-git guard — Running `--sandbox` outside a git repository or a non-existent directory now exits with a clear, actionable error instead of a misleading "detached HEAD" message. Two cases distinguished: directory doesn't exist vs. directory exists but isn't a git repo.
- [x] MCP watcher teardown handle — `setupSkillsWatcher()` returns a `{ close(): void }` handle. The MCP server stores it and calls `watcher?.close()` on shutdown, cancelling any pending debounce timer before stopping the fs.watch listener. Prevents timer leaks on repeated server restarts. 1,354 tests.
- [x] Context compaction + AGENTS.md — `:compact` REPL command (and `auto_compact_tokens` config for automatic compaction) replaces a long conversation with an LLM-generated summary, writing a `.compact-backup.json` before any destructive replacement. `AGENTS.md` in the project root (or `~/.phase2s/AGENTS.md` globally) is injected into the system prompt at startup. `phase2s doctor` reports AGENTS.md presence. Compaction utilities (`shouldCompact`, `buildCompactedMessages`, etc.) extracted to `src/core/compaction.ts` as pure, tested functions. 1,409 tests.
- [x] AGENTS.md in one-shot and MCP modes — `phase2s run "..."` now loads AGENTS.md before constructing the agent, matching REPL behavior. The MCP server (`phase2s mcp`) loads AGENTS.md once at startup and passes it to every tool call — zero per-request I/O. Non-ENOENT load errors (permission denied, directory named AGENTS.md) surface as warnings instead of being swallowed silently. 1,471 tests.
- [x] Rate limit resilience (v1.32.0) — typed `RateLimitError` propagates cleanly from all 7 providers through the full call stack. `rate_limited` ProviderEvent replaces silent 429 swallowing. Auto-backoff with configurable `rate_limit_backoff_threshold` (default 60 s, up to 3 attempts per call). `phase2s goal` exits 2 (paused, not failure) on rate limit — CI can distinguish "paused" from "broken." REPL checkpoints and exits 0. Compaction and orchestrator paths propagate `RateLimitError` instead of swallowing it. `parseRetryAfter()` handles both integer-seconds and HTTP-date formats, capped at 3600 s. 1,492 tests.
- [x] Rate limit hardening (v1.33.0) — session saved before every rate-limit exit so `--resume` always includes the last user message. Parallel executor uses `Promise.allSettled` so completed sibling workers' results are preserved when one hits a 429 — only the interrupted worker re-runs on resume. Codex provider correctly detects rate limits even when partial text was already streamed. `RateLimitError` gains a `kind` field: blocked providers (policy refusal, content filter) show ⛔ with a "Switch provider" hint; transient rate limits show ⏸ with retry timing. Backoff constants extracted to `src/providers/backoff.ts`, compaction logic extracted to `src/core/compaction.ts`. 1,522 tests.
- [x] Skills quality audit (v1.34.0) — six D-rated built-in skills rewritten to B+ standard with unconditional verify steps and datetime-stamped artifact saves to `.phase2s/`: `/review`, `/ship`, `/docs`, `/investigate`, `/tdd`, and `/skill`. The `skill` meta-skill now generates structural `## Output`, `## Verify`, and `## Save` sections so every new skill starts at B-quality minimum. 14 skills gain typed `inputs:` frontmatter exposing named MCP parameters and `{{param}}` body substitution.
- [x] Resilience closure (v1.35.0) — parallel workers cancel sibling HTTP streams immediately when one hits a rate limit (per-batch `AbortController`; completed work preserved via `Promise.allSettled`). Auto-compaction stops cascading after a configurable cap (`max_auto_compact_count`, default 3; manual `:compact` doesn't count). `phase2s goal --reasoning-effort high|low|default` overrides the model tier for all unlabeled subtasks. Fixed: auto-compact counter now increments only when compaction actually replaces the conversation. Fixed: `--reasoning-effort` validates at parse time. 1,548 tests.
- [x] Orchestrator checkpoint + resume (v1.36.0) — when the multi-agent orchestrator hits a 429 mid-level, Phase2S checkpoints completed jobs (including architect context files) and exits 2. `--resume` rehydrates the checkpoint: completed jobs skip re-execution, architect context is reconstructed from stored stdout and injected into downstream workers, and failed/skipped job states propagate forward. Path traversal guard added: `job.id` from on-disk checkpoints is validated before any context file path construction. 1,561 tests.
- [x] Orchestrator sibling cancellation (v1.37.0) — `executeOrchestratorLevel()` creates a per-level `AbortController`. When any job hits a 429, it fires `controller.abort()` so siblings exit at their next turn boundary instead of running to completion. Closes the final gap in rate-limit resilience for orchestrator-mode runs. `Promise.allSettled` preserves completed work. 1,565 tests.
- [x] `@file` attachment for the REPL (v1.38.0) — `@path/to/file.ts` in any REPL prompt inlines the file as a `<file path="...">` preamble block before the message reaches the model. Tab-completes against project filenames. 20 KB / 500-line limits; path traversal blocked via `assertInSandbox`. Multiple tokens per prompt, deduplication, error token preservation. 1,594 tests.
- [x] `@url` attachment + `@file` one-shot (v1.39.0) — `@https://...` tokens fetch and inline URL content using Mozilla Readability for clean HTML extraction. SSRF protection (RFC 1918, loopback, link-local, redirect re-check). `@file` tokens now work in `phase2s run "..."` one-shot mode. 512 KB HTML pre-parse limit, 20 KB post-parse limit. 18 new tests; 5 security and correctness fixes from `/review`. 1,612 tests.
- [x] `:goal` REPL command (v1.40.0) — run a goal spec from inside the REPL with `:goal specs/auth.md`. No more session exit: the goal runs in-process and reports success, failure, challenged, or rate-limit pause inline. `throwOnRateLimit` flag prevents `process.exit(2)` from killing the REPL on a 429. Reentrancy guard blocks a second `:goal` while one is running. Smart model widened to all retry-loop callers (`replan`, `checkCriteria`, `analyzeFailures`, `identifyFailedSubtasks`). Fixed: `RunLogger` fd leak on rate-limit throw. Fixed: compaction XML `&` escape ordering. `handleRunGoalCase` extracted for testability. 25 new tests. 1,630 tests.
- [x] REPL UX polish — `:dump` and `:dump html` export the current session as a markdown transcript or self-contained HTML page written to `.phase2s/exports/`. `:help` prints all REPL commands with descriptions so you never need to look up the cheatsheet. Fuzzy `@file` Tab completion upgraded: Tab on `@agt` now recursively walks the project tree and returns all filenames whose basename contains "agt" — no need to type the full path prefix. Path traversal hardened: `../` fragments blocked at both the `resolve()` and `relative()` level; dotfiles excluded from completions. All three features reviewed and hardened before ship. 30 new tests. (v1.41.0)
- [x] `:dump html` rendered output (v1.42.0) — `renderSessionHtml()` now uses `marked` v18 to convert the markdown transcript to proper HTML: `##` headings become `<h2>`, `---` becomes `<hr>`, fenced code blocks become `<pre><code>` with language classes. HTML content from message bodies is pre-escaped so `<script>` tags stay inert. `javascript:` hrefs are neutralized post-render. `@file` Tab completions ranked: basename prefix match beats substring match, shorter path beats deeper path, alphabetical tiebreak. Flaky `clone.test.ts` ENOTEMPTY CI race fixed. 1,677 tests.
- [x] Security and resilience hardening (v1.43.0) — four targeted fixes shipped in one sweep: `@file` Tab completion now uses iterative BFS so files in shallow directories are always returned first (depth-4 cap removed); compaction backup writes use a tmp-then-rename atomic pattern so a mid-write crash can never corrupt the recovery file; all variable-path `execSync` calls in `--sandbox` replaced with `execFileSync` array form to close shell injection; `plans_write` blocks writes when `plans/` is a symlink pointing outside the project root. 1,684 tests.
- [x] `phase2s provider` subcommand (v1.44.0) — `list`, `login`, and `logout` actions for provider management without re-running `phase2s init`. `provider list` shows all 7 providers and marks the active one (warns if `PHASE2S_PROVIDER` env var overrides the config). `provider login` switches provider, saves credentials to `.phase2s.yaml`, clears provider-scoped model fields on switch, preserves all other config (webhooks, system prompt, tool lists) via YAML parse/patch/serialize. `provider logout` removes only the API key field; codex-cli and ollama print an informational note. API key input is masked (no terminal scrollback). Config file permissions set to `0o600`. 1,694 tests.
- [x] Semantic learnings injection (v1.46.0) — `loadRelevantLearnings()` replaces truncate-oldest with embedding-based retrieval when Ollama is configured. `src/core/embeddings.ts` calls the native `/api/embed` endpoint (strips `/v1` suffix automatically). `src/core/search-index.ts` builds an incremental vector index at `.phase2s/search-index.jsonl` with SHA-256 content-hash staleness detection and atomic writes (temp+rename). `ollamaEmbedModel` config field separates the embed model from the chat model. `formatLearningsForPrompt` `skipCharCap` option bypasses the 2000-char truncation when semantic retrieval is active. All 4 `loadLearnings` call sites in the agent loop updated. Falls back to recency-based injection when Ollama is unavailable. 1,730 tests.
- [x] Model defaults updated (v1.46.0) — codex-cli default updated to `gpt-5.4` (read from `~/.codex/config.toml` when present); Ollama default updated to `gemma4:latest` (5 locations: config, init wizard, getting-started doc, configuration doc, config test).
- [x] Security & Resilience Hardening v2 (v1.47.0) — per-turn `[PHASE2S_LEARNINGS]` context messages: learnings injected as a rolling user message before each LLM turn instead of baked into the system prompt at startup, keeping them fresh as you save new ones mid-session (`agent.refreshLearnings()` updates the active string between REPL turns). `normalizeConfigError()` converts raw `loadConfig()` errors (ZodError, YAML parse, ENOENT, EACCES) into actionable CLI messages at all 5 call sites. `heuristicSort()` keyword/recency hybrid as the Ollama fallback. Provider enum consolidation: `PROVIDERS`/`isValidProvider()`/`getProviderKeyField()` centralized in `provider-registry.ts` (inline lists removed from `config.ts`, `doctor.ts`, `init.ts`). Anthropic 400 fix: consecutive plain-text user messages (LEARNINGS + actual prompt) now merged with `\n\n` instead of rejected. 1,756 tests.
- [x] E2E eval framework (v1.48.0) — `npm run eval` runs all `eval/*.eval.yaml` cases through live Phase2S skills, scores each output with an LLM judge (hybrid: structural regex + quality LLM), and exits 1 if any score falls below 6.0. Becomes the deploy gate for prompt quality regressions. Ships with two live eval cases (`adversarial`, `review`) and a user guide at `docs/eval.md`. Eight safety bugs found and fixed by `/review` before merge: null-score gate bypass (most critical), timer leak, substituteInputs outside try/catch, per-file YAML error isolation, writeEvalResults crash path, filename collision for same-skill cases, double regex compile, review.eval.yaml scope and severity format bugs. 96 new tests. 1,852 tests.
- [x] Eval framework completion (v1.49.0) — `fixture:` YAML block scaffolds a temp project directory for skills that write files (e.g. `/satori`); torn down unconditionally after the run. `verify_files` checks that listed paths exist in the fixture after the run. `satori.eval.yaml` is now active (was stubbed since v1.48.0). `scoresBySkill` summary shows min–max range when multiple cases share a skill (`adversarial=7-9`). `MAX_OUTPUT_CHARS = 20,000` cap prevents token limit errors in the judge prompt. Satori retry loop wired to eval runner: `skill.retries` and `eval_command` now thread through to `agent.run()`. Tool sandbox checks (file_read, file_write, shell, glob, grep) thread the agent's injected `cwd` through all five tools via factory functions — fixture evals now operate in the temp directory as intended. Five additional safety bugs caught by `/review`: path traversal in fixture paths, partial tmpDir leak, verify_files no-op without fixture, teardown exception masking, scoresBySkill test false positive. 1,796 tests.
- [x] Observability & eval hardening (v1.50.0) — `:commit` REPL prompts now reuse the main readline instead of creating concurrent interfaces on stdin. The anonymous `line` handler is extracted as named `onLine`; each `:commit` prompt site calls `removeListener` before prompting and restores it in `finally`. `ask()` gains `{ noClose: true }` so Ctrl+C during a `:commit` prompt cancels the prompt but keeps the REPL alive. REPL prints `↻ learnings refreshed (N entry/entries)` after each `agent.refreshLearnings()` call. Ollama embedding cache now invalidates when `ollamaEmbedModel` changes: `SearchEntry` gains an optional `model` field; `getOrBuildIndex` takes a required `embedModel` param; old entries without a `model` field re-embed once on first run. `judgeE2E` hardened: invalid regex patterns record `status: "missed"` with `evidence: "(invalid regex: …)"` instead of falling through to the LLM judge; patterns longer than 500 characters or outputs exceeding `MAX_OUTPUT_CHARS` also route to the LLM judge as a ReDoS budget guard. `STRUCTURAL_PATTERN_MAX_LEN` exported alongside `MAX_DIFF_CHARS` and `MAX_OUTPUT_CHARS`. 13 new tests. 1,816 tests.
- [x] Semantic codebase indexing (v1.51.0) — `phase2s sync` discovers all git-tracked source files via `git ls-files` (respects all `.gitignore` sources; no JS gitignore library needed), embeds each file's first 4,000 characters using the configured Ollama embed model, and writes an incremental vector index to `.phase2s/code-index.jsonl`. Unchanged files (same SHA-256 + same model) are skipped; deleted files are GC'd; writes are atomic (PID+timestamp tmp + rename). `phase2s search <query>` embeds the query and returns top-K files by cosine similarity with one-line snippets. `--top N` flag controls result count (default 5). Staleness warning when HEAD commit is newer than the index; model mismatch warning when the index was built with a different embed model. `phase2s doctor` extended to check for a missing code index. Path traversal guard in `discoverFiles`, embed-failure resilience (stale entries preserved when Ollama is down), and O(1) staleness check via `git log -1` applied in post-sprint hardening. Separate from the learnings index — different GC semantics, different use case. 35 new tests. 1,851 tests.

---

## License

MIT
