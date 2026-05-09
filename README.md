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

**One-command conductor — spec + orchestration in a single step:**

```bash
# Skip spec writing entirely — describe what you want in plain English
phase2s conduct "add per-user rate limiting to the API"
```

`phase2s conduct` generates a role-annotated multi-agent spec from your goal, previews the dependency graph, confirms with you, then hands off to the orchestrator — all in one command.

```bash
# Preview the spec and DAG without running anything
phase2s conduct "add per-user rate limiting" --dry-run

# Skip the confirmation prompt
phase2s conduct "add caching to the data layer" --yes

# Use a smarter model for spec generation
phase2s conduct "refactor auth module" --model gpt-4o

# Save the final summary as JSON
phase2s conduct "add search indexing" --output .phase2s/runs/search-summary.json
```

| Flag | Description |
|------|-------------|
| `--dry-run` | Generate spec and show DAG preview only |
| `--model <model>` | Override model for spec generation (default: `smart_model`) |
| `--workers <n>` | Max parallel workers per dependency level |
| `--max-attempts <n>` | Max retry loops for the orchestrator (default: 3) |
| `--quiet` | Suppress verbose progress output |
| `--output <path>` | Write final summary JSON to this path |
| `-y, --yes` | Skip the "▶ Run? [y/N]" confirmation |

The generated spec is saved to `.phase2s/specs/` so you can review, edit, or reuse it with `phase2s goal`.

**Via MCP** — Claude Code can run the full conductor without leaving a conversation:

```
phase2s__conduct({ goal: "add rate limiting to the API" })
phase2s__conduct({ goal: "refactor the auth module", dryRun: true })
```

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

`phase2s search` embeds your query, scores every indexed entry by cosine similarity, and returns the top matches. When chunking is active, results show the specific function or section that matched — not just the file:

```
Top 5 matches for "rate limiting middleware":

1. src/providers/backoff.ts:14 — function rateLimitBackoff() {  (0.91)
   export async function rateLimitBackoff(

2. src/core/agent.ts:88 — method run() {  (0.87)
   async run(prompt: string,

3. src/cli/index.ts  (0.84)
   export async function startRepl(config: Config): Promise<void>
```

**The index is separate from the learnings index.** `.phase2s/search-index.jsonl` is your learnings memory; `.phase2s/code-index.jsonl` is your codebase map. They use the same Ollama embed infrastructure but GC and sync independently.

Requires `ollamaBaseUrl` to be set in `.phase2s.yaml`:

```yaml
ollamaBaseUrl: http://localhost:11434/v1
ollamaEmbedModel: nomic-embed-text  # optional; defaults to nomic-embed-text:latest
```

`phase2s doctor` checks for a missing code index and tells you to run `phase2s sync`.

#### `:search` REPL command

Inside the REPL you can search without leaving the conversation:

```
you > :search rate limiting middleware
```

`:search` runs the same pipeline as `phase2s search` — embeds your query, ranks by cosine similarity, and prints results inline. Appears in `:help`.

#### `code_search` agent tool

When Ollama is configured, the Phase2S agent gains a `code_search` tool automatically — no setup required beyond a synced index. The agent can now answer questions like *"find where rate-limit backoff is handled"* by embedding the question, searching the code index, and reading the relevant snippet before responding.

Results include the file path, line range (e.g. `src/providers/backoff.ts:14–32`), function name, similarity score, and an inline code snippet. If the index is stale the tool prepends a warning; if Ollama is unreachable it returns a descriptive error rather than silently failing.

#### Automatic code context injection

When Ollama is configured and a code index exists, Phase2S automatically injects the most relevant code chunks into your conversation before each REPL turn — without you asking. You'll see a dim status line confirming it:

```
↻ code context: 3 chunks
```

This works the same way as learnings injection: Phase2S embeds your query once, uses that vector to rank both your learnings and your codebase, and prepends the top-K code chunks as context before the model responds. The embedding call is shared — one Ollama round-trip per turn covers both.

The injected chunks appear as a `[PHASE2S_CODE_CONTEXT]` message that is stripped from saved sessions so it doesn't bloat your history. Only chunks scoring above 0.25 cosine similarity are injected.

To turn it off for a session:

```bash
phase2s --no-rag
```

To disable permanently, add to `.phase2s.yaml`:

```yaml
codeRag: false
```

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

**Custom verification command** — configure what `/satori` and `phase2s task` run to check your work:

```yaml
# .phase2s.yaml
verifyCommand: pytest tests/ -x  # or: go test ./... or: npm test
```

Override per-run with `phase2s task --verify "bun test" "your task here"`.

**Task mode tuning** — control the autonomous task runner's behavior:

```yaml
# .phase2s.yaml
doomLoopThreshold: 2        # abort faster when stuck (default: 3, min: 2)
verifyOnEveryWrite: true    # run verify after each file_write, not just end-of-turn
trivialInputMinWords: 2     # skip RAG for 1- and 2-word REPL inputs (default: 1)
```

Task flags for one-off overrides:

```bash
phase2s task --quiet "fix the type errors"           # suppress streaming, print result only
phase2s task --timeout 120 "refactor auth.ts"        # abort after 120 seconds
phase2s task --output result.md "write a plan"       # save output to file
phase2s task --doom-loop-threshold 2 "fix the bug"   # tighter doom-loop for this run
```

**Headless browser** — enable for the `/qa` skill to test web apps:

```yaml
# .phase2s.yaml
browser: true  # requires playwright installed
```

---

## Roadmap

Phase2S ships fast — most sprints close in a day. The full history of shipped features, from the initial Codex CLI provider through the current v1.59.0 task hardening release, lives in one place:

[View the full roadmap →](ROADMAP.md)

---

## License

MIT
