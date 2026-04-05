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

**If you want to run everything locally (free, private, no internet)**

```bash
npm install -g @scanton/phase2s
ollama pull llama3.1:8b
export PHASE2S_PROVIDER=ollama
phase2s
```

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
- [Dark factory](docs/dark-factory.md) — write a spec, run `phase2s goal`, get a feature
- [Claude Code integration](docs/claude-code.md) — MCP setup, adversarial review, CLAUDE.md routing rules
- [Skills reference](docs/skills.md) — all 29 skills with examples
- [Workflows](docs/workflows.md) — real development sessions end to end
- [Memory and persistence](docs/memory.md) — session resume, `/remember`, what gets saved
- [Writing custom skills](docs/writing-skills.md) — create your own `/commands`
- [GitHub Action](docs/github-action.md) — `uses: scanton/phase2s@v1` for CI (requires API key)
- [Advanced](docs/advanced.md) — streaming, model routing, tool allow/deny
- [Configuration](docs/configuration.md) — `.phase2s.yaml` and environment variables

---

## Roadmap

- [x] Codex CLI provider (ChatGPT subscription, no API key required)
- [x] 29 built-in skills across 6 categories
- [x] File sandbox: tools reject paths outside project directory, including symlink escapes
- [x] 399 tests covering all tools, core modules, agent integration, and goal executor
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

---

## License

MIT
