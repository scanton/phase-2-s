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

### Validate before running

Before committing a 20-minute run, lint the spec:

```bash
phase2s lint .phase2s/specs/2026-04-04-11-00-rate-limiting.md
```

This catches structural problems instantly — missing title, empty problem statement, no sub-tasks, no acceptance criteria. Exits 0 if the spec is runnable (warnings OK), exits 1 on errors. Ideal in a pre-run script:

```bash
phase2s lint specs/rate-limiting.md && phase2s goal specs/rate-limiting.md
```

Two additional checks:

- **evalCommand PATH check** — if your spec uses `eval: pytest tests/` and `pytest` is not on PATH, lint warns immediately instead of failing 20 minutes into a run. (This check is skipped for the default `npm test` — most machines have npm.)
- **Large spec warning** — if your spec has more than 8 sub-tasks, lint warns. Large specs are unreliable; the retry combinatorics grow fast. Break into multiple smaller specs and run them sequentially.

### Preview without running

To see what `phase2s goal` would execute — without making a single LLM call — use `--dry-run`:

```bash
phase2s goal .phase2s/specs/2026-04-04-11-00-rate-limiting.md --dry-run
```

Example output:

```
Spec: Rate Limiting

Eval: npm test

Sub-tasks (2):
  1. Token bucket core
     Input:  Requests with user ID (auth) or IP address (anon)
     Output: src/utils/rate-limiter.ts — RateLimiter class
     When:   Unit tests for bucket fill, drain, and window reset pass
  2. Express middleware
     Input:  RateLimiter class
     Output: src/middleware/rate-limit.ts registered in src/app.ts
     When:   Integration tests with real HTTP requests pass

Acceptance Criteria (4):
  · Authenticated users: 100 req/min, 429 + Retry-After header on exceed
  · Unauthenticated IPs: 20 req/min, 429 + Retry-After header on exceed
  · All existing tests continue to pass
  · npm test passes after implementation
```

Exits in under one second. Useful before committing to a long run: if the decomposition looks wrong, fix the spec first.

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

The raw JSONL log contains everything at event granularity: `goal_started`, `subtask_started/completed`, `eval_started/completed`, `criteria_checked`, `eval_judged`, `goal_completed`. Read it directly if you need machine-readable detail (e.g., via `file_read` in Claude Code).

The log survives process death — it's written incrementally, not at the end. If a run is interrupted, the log contains everything up to the interruption.

### Score your spec against a diff

`phase2s judge` compares your spec's acceptance criteria against a git diff and tells you how well the implementation covered them — criterion by criterion, with a 0-10 score.

```bash
# Score a completed run
git diff HEAD~1 | phase2s judge .phase2s/specs/my-spec.md

# Or pass a diff file directly
phase2s judge .phase2s/specs/my-spec.md --diff changes.diff
```

Output:

```
JUDGE REPORT: my-spec.md
═══════════════════════════════════

Score: 8.5 / 10

Criteria:
  ✓ met        Authenticated users: 100 req/min, 429 + Retry-After header on exceed
               evidence: src/middleware/rate-limit.ts:23
               confidence: 0.95
  ✓ met        npm test passes after implementation
               evidence: (passing test suite)
               confidence: 0.9
  ~ partial    Unauthenticated IPs: 20 req/min, 429 + Retry-After
               evidence: src/middleware/rate-limit.ts:44 (limit set, header missing)
               confidence: 0.75
  ✗ missed     All existing tests continue to pass
               evidence: (none found in diff)
               confidence: 0.8

Diff stats: 3 files changed, 87 insertions, 2 deletions
```

Exit code 0 if score ≥ 7, exit code 1 if score < 7. Use in CI to gate merges:

```bash
git diff main | phase2s judge specs/rate-limiting.md || exit 1
```

**Score during a goal run** — add `--judge` to run the judge automatically after every attempt:

```bash
phase2s goal specs/rate-limiting.md --judge
```

The judge score appears in the terminal output and is captured as an `eval_judged` event in the run log, rendered by `phase2s report`:

```
✓ Goal complete — 2 attempts — 26m 37s
Judge: 8.5/10 — All key criteria met, Retry-After header partially implemented.
```

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

[1/2] Running: Token bucket core
You are running in satori mode — persistent execution until verified complete...

[model implements src/utils/rate-limiter.ts]
[model writes tests in test/utils/rate-limiter.test.ts]
Verification: npm test
PASS (12 tests)
  Done in 8.2s

[2/2] Running: Express middleware
[model implements src/middleware/rate-limit.ts]
[model registers middleware in src/app.ts]
Verification: npm test
FAIL — test/middleware/rate-limit.test.ts: authenticated user still throttled after window

[satori attempt 2: analyzes failure, fixes window reset logic]
Verification: npm test
PASS (24 tests)
  Done in 11.0s

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

[1/1] Retrying: Express middleware
[Previous failure: The middleware was checking limits after sending the response.
The 429 was never reaching the client. Fix this specifically.]

[satori implements fix: move limit check before res.send()]
npm test: PASS
  Done in 7.3s

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

**Declare file ownership for parallelism.** When running with `--parallel`, the dependency graph is built from which files each sub-task touches. Add `**Files:** src/foo.ts, src/bar.ts` to a sub-task to declare this explicitly — it overrides the regex heuristic and prevents false conflicts. Sub-tasks that share no files run in parallel; sub-tasks that share files are serialized automatically.

**Eval command should be deterministic.** `npm test` is good. A test that flakes randomly will cause false failures and unnecessary retries. Fix flaky tests before running `phase2s goal`.

**Smaller specs work better.** A spec with 2-3 sub-tasks and 3-4 criteria is much more reliable than one with 8 sub-tasks and 12 criteria. Break large features into multiple specs and run them sequentially.

**Use the Constraint Architecture section.** "Must Do" and "Cannot Do" are injected into every sub-task's prompt. If you have an architectural requirement (use this library, don't touch that file), put it here.

---

## Parallel execution

When your spec has 3 or more independent sub-tasks, Phase2S can run them in parallel inside git worktrees — each worker gets its own isolated branch, implements its sub-task, and merges back at the level boundary.

```bash
# Auto-detected (3+ independent subtasks)
phase2s goal my-spec.md

# Force parallel (any spec)
phase2s goal my-spec.md --parallel

# Force sequential (opt out)
phase2s goal my-spec.md --sequential

# Control concurrency (default 3, max 8)
phase2s goal my-spec.md --parallel --workers 5

# Live tmux dashboard (requires tmux)
phase2s goal my-spec.md --parallel --dashboard
```

How it works:

1. Phase2S builds a dependency graph from the `**Files:**` annotations in your spec (or infers them from descriptions with regex).
2. It groups independent sub-tasks into execution levels via topological sort.
3. Each level's sub-tasks run in parallel in separate git worktrees. Workers get a git diff summary of what prior levels changed, so each worker understands what's already been built.
4. At each level boundary, workers merge back into the main branch in spec order. If two workers modified the same file in conflicting ways, the merge halts with a clear conflict report.

The `phase2s report` output includes per-level timing and a wall-clock vs sequential estimate with savings:

```
Goal: my-spec.md (parallel)

  Level 0 (3 workers)
    ✓ Create API routes     (4m 12s)  [worker 0]
    ✓ Add database schema   (3m 44s)  [worker 1]
    ✓ Write unit tests      (2m 58s)  [worker 2]
  Level merge: 12s

  Level 1 (1 worker)
    ✓ Wire everything       (6m 03s)

✓ Goal complete — 1 attempt — 11m 07s (est. 17m sequential — 35% faster)
```

Sub-tasks that cannot be parallelized (they share files or form a dependency chain) are automatically serialized. Phase2S degrades gracefully: if a cycle is detected in the dependency graph, the whole spec runs sequentially without error.

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

- **Multi-repo changes.** The executor works in the current directory only.
- **Non-deterministic evals.** If your test suite is flaky or non-deterministic, retries won't be reliable.
- **Specs larger than the context window.** Very long specs (thousands of lines) may hit model context limits. Keep specs focused.
