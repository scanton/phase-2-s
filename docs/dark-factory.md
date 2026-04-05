# Dark Factory: Specs In, Features Out

`phase2s goal` is Phase2S's autonomous execution mode. You give it a spec file that describes what you want built and how you'll know it's done. It handles everything from there — breaking the work into sub-tasks, implementing each one, running your tests, checking whether the results match your criteria, and retrying with failure analysis if anything doesn't pass.

You don't watch it work. You come back when it's done.

This doc walks through the whole pattern from scratch: writing a spec, running the goal executor, reading the output, and understanding what happens when it has to retry.

---

## What you need

- Phase2S installed: `npm install -g @scanton/phase2s`
- Codex CLI authenticated: `npm install -g @openai/codex && codex auth` (one-time browser login)
- A project with a test command that exits 0 on pass and non-zero on fail (`npm test` works out of the box)

The goal executor uses your **ChatGPT subscription** for all AI work. No API key needed.

---

## Step 1: Write a spec

A spec is a markdown file that answers five questions:

1. **What are we building and why?** (Problem Statement)
2. **How will we know it's done?** (Acceptance Criteria)
3. **What are the hard rules?** (Constraint Architecture)
4. **What are the individual pieces of work?** (Decomposition)
5. **How do we verify it?** (Evaluation Design + Eval Command)

You can write this by hand, or use Phase2S to interview you through it.

### Option A: Let Phase2S interview you

Start the REPL and run `/deep-specify`:

```bash
phase2s
you > /deep-specify add rate limiting to the API
```

Phase2S asks you questions one at a time — where the logic lives, what the limits are, what storage to use, what failure mode looks like. When you've answered everything, it writes the spec to `.phase2s/specs/`.

```
assistant > Spec saved to .phase2s/specs/2026-04-04-11-00-rate-limiting.md

SPEC READY: .phase2s/specs/2026-04-04-11-00-rate-limiting.md
NEXT: run `phase2s goal .phase2s/specs/2026-04-04-11-00-rate-limiting.md`
```

### Option B: Write it yourself

Create a markdown file anywhere. The format:

```markdown
# Spec: Rate Limiting

Generated: 2026-04-04
Spec ID: rate-limiting

## Problem Statement
Add token-bucket rate limiting to the Express API to protect against overuse.
Authenticated users get 100 requests per minute. Unauthenticated IPs get 20
per minute. Both return HTTP 429 with a Retry-After header when the limit is hit.

## Acceptance Criteria
1. Authenticated users: 100 req/min, 429 + Retry-After header on exceed
2. Unauthenticated IPs: 20 req/min, 429 + Retry-After header on exceed
3. All existing tests continue to pass
4. npm test passes after implementation

## Constraint Architecture
**Must Do:** Use an in-memory store; include Retry-After header on 429 responses
**Cannot Do:** Redis backend; distributed rate limiting; per-route config (v1)
**Should Prefer:** Token bucket algorithm; middleware-level implementation
**Should Escalate:** If the existing middleware registration order is ambiguous

## Decomposition
### Sub-task 1: Token bucket core
- **Input:** Requests with user ID (auth) or IP address (anon)
- **Output:** `src/utils/rate-limiter.ts` — RateLimiter class
- **Success criteria:** Unit tests for bucket fill, drain, and window reset pass

### Sub-task 2: Express middleware
- **Input:** RateLimiter class
- **Output:** `src/middleware/rate-limit.ts` registered in `src/app.ts`
- **Success criteria:** Integration tests with real HTTP requests pass; middleware
  registered before auth middleware

## Evaluation Design
| Test Case | Input | Expected Output |
|-----------|-------|-----------------|
| Auth user under limit | 50 requests with valid JWT | All 200 |
| Auth user over limit | 101 requests with valid JWT | 429 on 101st with Retry-After |
| Anon IP under limit | 15 requests no auth | All 200 |
| Anon IP over limit | 21 requests no auth | 429 on 21st with Retry-After |

## Eval Command
npm test
```

**The parser is lenient.** You don't need all five sections to run `phase2s goal`. If Decomposition is missing, the executor runs eval only. If Acceptance Criteria is missing, it reports the raw eval output and exits. Use what you have.

---

## Step 2: Run the goal executor

```bash
phase2s goal .phase2s/specs/2026-04-04-11-00-rate-limiting.md
```

With a custom attempt limit:

```bash
phase2s goal .phase2s/specs/2026-04-04-11-00-rate-limiting.md --max-attempts 5
```

The executor runs immediately. No interactive prompts.

### Challenge the spec before running

Add `--review-before-run` to have the spec challenged by GPT before a single line of code is written:

```bash
phase2s goal .phase2s/specs/2026-04-04-11-00-rate-limiting.md --review-before-run
```

This runs the spec's decomposition and acceptance criteria through the `/adversarial` skill. If GPT raises objections:

```
Spec CHALLENGED before execution. Adversarial review response:

VERDICT: CHALLENGED
STRONGEST_CONCERN: The token bucket reset logic is underspecified.
OBJECTIONS:
1. The Decomposition says "bucket fill/drain tests pass" but doesn't specify
   what the window duration is. A 1-second window and a 60-second window are
   both satisfiable by the criterion as written — this ambiguity will produce
   inconsistent output.
2. Acceptance Criteria #1 says "100 req/min" but the Decomposition has no
   sub-task for the middleware that enforces the limit. The criteria could
   pass trivially if the test mocks the rate limiter.
APPROVE_IF: Specify the window duration; add a sub-task for the enforcement
middleware.
```

No code runs until you fix the objections and re-run. If the spec is sound:

```
Adversarial review: APPROVED. Proceeding with execution.
```

Use `--review-before-run` on new specs. Skip it on re-runs where you're iterating on a known-good spec.

### Get notified when it finishes

Dark factory runs take 20–60 minutes. Add `--notify` to get a notification when the run completes:

```bash
phase2s goal .phase2s/specs/2026-04-04-11-00-rate-limiting.md --notify
```

**On macOS:** a system notification appears automatically (via `osascript`, no extra setup).

**Cross-platform (macOS, Linux, Windows):** three webhook channels are supported. Set whichever one (or more) you use:

```bash
# Slack
export PHASE2S_SLACK_WEBHOOK=https://hooks.slack.com/services/...

# Discord
export PHASE2S_DISCORD_WEBHOOK=https://discord.com/api/webhooks/...

# Microsoft Teams
export PHASE2S_TEAMS_WEBHOOK=https://outlook.office.com/webhook/...

phase2s goal my-spec.md --notify
```

Or configure channels permanently in `.phase2s.yaml`. The fastest way is `phase2s init`, which walks you through each channel interactively. To do it by hand:

```yaml
notify:
  slack: "https://hooks.slack.com/services/T.../B.../..."
  discord: "https://discord.com/api/webhooks/.../..."
  teams: "https://outlook.office.com/webhook/..."
  mac: true  # default on macOS; set false to disable
```

**Getting webhook URLs:**
- **Slack:** Apps → Incoming Webhooks → Add New Webhook. Copy the `https://hooks.slack.com/services/...` URL.
- **Discord:** Server Settings → Integrations → Webhooks → New Webhook. Copy the URL.
- **Teams:** Channel → Connectors → Incoming Webhook → Configure. Copy the URL.

All channels are fail-safe: errors go to stderr and never block the run. Multiple channels can be active simultaneously — useful for team projects where some members use Slack and others use Teams.

If no channels are configured (Linux/Windows with no webhook set), `--notify` logs a warning pointing to the available env vars.

### Read the run report

Every `phase2s goal` run writes a structured JSONL log to `.phase2s/runs/<timestamp>-<hash>.jsonl` relative to the spec file directory. The path is printed on exit:

```
Run log: /your/project/.phase2s/runs/2026-04-05T12-00-00-a1b2c3d4.jsonl
```

To read a human-readable summary:

```bash
phase2s report .phase2s/runs/2026-04-05T12-00-00-a1b2c3d4.jsonl
```

```
Goal: rate-limiting.md

  Attempt 1/3
    ✓ Token bucket core      (8m 12s)
    ✗ Express middleware     (11m 03s)
  Eval: npm test

  Criteria:
    ✗ 100 req/min enforced

  Attempt 2/3
    ✓ Express middleware     (7m 22s)
  Eval: npm test

  Criteria:
    ✓ 100 req/min enforced

✓ Goal complete — 2 attempts — 26m 37s
```

The raw JSONL log contains everything at event granularity: `goal_started`, `subtask_started/completed`, `eval_started/completed`, `criteria_checked`, `goal_completed`. Read it directly if you need machine-readable detail (e.g., via `file_read` in Claude Code).

The log survives process death — it's written incrementally, not at the end. If a run is interrupted, the log contains everything up to the interruption.

---

## Step 3: Watch it work (or don't)

The executor prints progress as it runs:

```
Goal executor: Rate Limiting
Eval command: npm test
Sub-tasks: 2
Acceptance criteria: 4
Max attempts: 3

==================================================
Attempt 1/3
==================================================

Running sub-task: Token bucket core
You are running in satori mode — persistent execution until verified complete...

[model implements src/utils/rate-limiter.ts]
[model writes tests in test/utils/rate-limiter.test.ts]
Verification: npm test
PASS (12 tests)

Running sub-task: Express middleware
[model implements src/middleware/rate-limit.ts]
[model registers middleware in src/app.ts]
Verification: npm test
FAIL — test/middleware/rate-limit.test.ts: authenticated user still throttled after window

[satori attempt 2: analyzes failure, fixes window reset logic]
Verification: npm test
PASS (24 tests)

Running evaluation: npm test
...24 tests pass...

Acceptance criteria:
  ✓ Authenticated users: 100 req/min, 429 + Retry-After header on exceed
  ✓ Unauthenticated IPs: 20 req/min, 429 + Retry-After header on exceed
  ✓ All existing tests continue to pass
  ✓ npm test passes after implementation

✓ All acceptance criteria met after 1 attempt(s).
```

Exit code 0 on success, 1 on failure. Use in scripts:

```bash
phase2s goal my-spec.md && echo "Done" || echo "Failed — check output"
```

---

## What happens when it fails

If the first attempt doesn't meet all acceptance criteria, the executor doesn't give up. It:

1. Asks the model: "These criteria failed. Here's the eval output. In 2-3 sentences, what most likely went wrong?"
2. Asks the model: "Given that analysis, which sub-tasks most likely caused these failures?"
3. Re-runs only the relevant sub-tasks with the failure context appended to the prompt
4. Re-runs eval and checks criteria again

```
Attempt 1 criteria:
  ✓ npm test passes after implementation
  ✗ Authenticated users: 100 req/min, 429 + Retry-After on exceed
  ✗ Unauthenticated IPs: 20 req/min, 429 + Retry-After on exceed

Retrying 1 sub-task(s): Express middleware

==================================================
Attempt 2/3
==================================================

Running sub-task: Express middleware
[Previous failure: The middleware was checking limits after sending the response.
The 429 was never reaching the client. Fix this specifically.]

[satori implements fix: move limit check before res.send()]
npm test: PASS

Acceptance criteria:
  ✓ Authenticated users: 100 req/min, 429 + Retry-After on exceed
  ✓ Unauthenticated IPs: 20 req/min, 429 + Retry-After on exceed
  ✓ npm test passes after implementation

✓ All acceptance criteria met after 2 attempt(s).
```

If it exhausts all attempts without meeting criteria, it exits with code 1 and reports exactly which criteria failed. You know what's left to fix.

---

## How retry depth works

The executor has two retry loops:

- **Inner loop (satori):** For each sub-task, `/satori` runs implement → verify → retry up to 3x internally. It stops when tests pass or gives up and moves on.
- **Outer loop (goal executor):** After all sub-tasks run and eval is checked, if criteria fail, the outer loop runs again (up to `--max-attempts`, default 3).

Worst case for a 3-sub-task spec with default settings: 3 outer attempts × 3 inner satori retries × 3 sub-tasks = 27 implementation passes. In practice it's much less. The executor warns you if the combination is large:

```
Warning: Large spec with deep retry depth (5 sub-tasks × 3 attempts).
This may take a while and consume significant ChatGPT usage.
```

---

## Writing good specs

**Acceptance criteria should be independently testable.** Each criterion should describe something you can check mechanically. "The feature works" is not a criterion. "npm test passes after implementation" is.

**Sub-tasks should be sequentially independent.** Sub-task 2 can depend on sub-task 1's output, but they shouldn't both try to modify the same file at the same time. The executor runs them in order.

**Eval command should be deterministic.** `npm test` is good. A test that flakes randomly will cause false failures and unnecessary retries. Fix flaky tests before running `phase2s goal`.

**Smaller specs work better.** A spec with 2-3 sub-tasks and 3-4 criteria is much more reliable than one with 8 sub-tasks and 12 criteria. Break large features into multiple specs and run them sequentially.

**Use the Constraint Architecture section.** "Must Do" and "Cannot Do" are injected into every sub-task's prompt. If you have an architectural requirement (use this library, don't touch that file), put it here.

---

## The full workflow

```bash
# Start Phase2S
phase2s

# Get interviewed, produce a spec
you > /deep-specify add user notifications

# Phase2S asks questions: email vs in-app, real-time vs batched,
# storage, retry behavior, notification types. Answers create:
# .phase2s/specs/2026-04-04-14-00-user-notifications.md

# Exit REPL
you > /quit

# Execute the spec autonomously
phase2s goal .phase2s/specs/2026-04-04-14-00-user-notifications.md

# Do other things. Come back when it's done.
```

That's it. Spec in. Feature out.

---

## What `phase2s goal` can't do yet

- **Parallel sub-tasks.** Sub-tasks run sequentially. Parallel execution is deferred because concurrent agents writing to the same files cause conflicts.
- **Multi-repo changes.** The executor works in the current directory only.
- **Non-deterministic evals.** If your test suite is flaky or non-deterministic, retries won't be reliable.
- **Specs larger than the context window.** Very long specs (thousands of lines) may hit model context limits. Keep specs focused.
