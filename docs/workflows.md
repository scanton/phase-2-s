# Workflows

What does a real development day with Phase2S look like? This page shows concrete examples — real commands, realistic output, real decisions.

---

## Starting a new feature

You have a ticket: "Add rate limiting to the API." You're not sure exactly what the scope should be. Here's how Phase2S helps from zero to shipped.

**Step 1: Specify before writing code**

```
you > /deep-specify add rate limiting to the API

assistant > I'll work through the ambiguities before we write anything.

  1. Where does rate limiting live? Middleware (all routes), per-route decorators,
     or a separate gateway layer?

you > middleware, applied globally with per-route overrides

assistant > 2. What's the limit? Requests per second, per minute, per hour?
              Per IP, per user, or both?

you > 100 requests per minute per authenticated user, 20 per minute for
      unauthenticated requests. Per IP for unauthenticated.

assistant > 3. What happens when a client hits the limit — 429 immediately,
              or a queue with eventual processing?

you > 429 immediately, with Retry-After header

assistant > 4. Where does the rate limit state live? In-memory (lost on restart),
              Redis, or the database?

you > in-memory for now, Redis later

  Spec saved to .phase2s/specs/2026-04-04-rate-limiting.md

  Intent: Protect API endpoints from overuse with token-bucket rate limiting
  Boundaries: Global middleware, per-user and per-IP buckets, in-memory store
  Non-goals: Redis backend, distributed rate limiting, per-endpoint config (v2)
  Success criteria:
    - Authenticated users: 100 req/min, 429 + Retry-After on exceed
    - Unauthenticated IPs: 20 req/min, 429 + Retry-After on exceed
    - npm test passes after implementation

  Ready to plan. Run /plan or /autoplan to continue.
```

**Step 2: Get a consensus plan**

```
you > /consensus-plan add rate limiting to the API middleware

-- Planner pass --
Phase 1: Token bucket implementation (src/utils/rate-limiter.ts)
  - RateLimiter class, buckets Map, refill logic
  - Verify: unit tests for bucket fill/drain, 429 on exceed

Phase 2: Middleware integration (src/middleware/rate-limit.ts)
  - Extract user ID from auth header, fall back to IP
  - Call RateLimiter.check(), set Retry-After header on 429
  - Verify: integration test with real HTTP requests

Phase 3: Configuration (src/core/config.ts)
  - rateLimitPerUser: number, rateLimitPerIP: number, rateLimitWindow: ms
  - Defaults: 100, 20, 60000

-- Architect pass --
  CONCERN: The refill logic needs to account for the window start time, not just
  the last request time. Sliding window vs. fixed window matters here.
  SUGGESTION: Add a resetAt timestamp to each bucket for correct Retry-After math.

-- Critic pass --
  The in-memory store loses all state on restart. Fine for now per spec, but
  the middleware registration order matters — if auth middleware runs after rate
  limiting, unauthenticated requests will always hit the IP limiter even for
  authenticated users with a bad token. Check registration order in app.ts.

  No blocking objections. Plan approved with changes.

APPROVED WITH CHANGES
- Add resetAt to bucket for correct Retry-After header
- Verify middleware registration order in app.ts
```

**Step 3: Implement with satori**

```
you > /satori add rate limiting to the API middleware

Running /satori...
[Context snapshot: .phase2s/context/2026-04-04-14-32-rate-limiting.md]

-- Attempt 1 --
[agent creates src/utils/rate-limiter.ts]
[agent creates src/middleware/rate-limit.ts]
[agent registers middleware in app.ts]
[agent writes tests in test/middleware/rate-limit.test.ts]

Verification: npm test
  FAIL test/middleware/rate-limit.test.ts
    ✗ authenticated user: resets after window expires
      Expected: 100 requests allowed after 60s
      Actual: still throttled after window reset

-- Attempt 2 --
[agent reads failure]
[agent inspects RateLimiter.check() — refill logic uses Date.now() directly,
 doesn't clear the bucket on window expiry]
[agent fixes: add resetAt to bucket, check resetAt < Date.now() before drain]

Verification: npm test
  PASS (23 tests)

assistant > Rate limiting implemented. 2 attempts.

  Attempt 1 missed: the bucket wasn't cleared when the window expired.
  Fixed by adding resetAt timestamp to each bucket and checking it before
  the drain check.

  Files changed:
  - src/utils/rate-limiter.ts (new)
  - src/middleware/rate-limit.ts (new)
  - src/core/config.ts (rateLimitPerUser, rateLimitPerIP, rateLimitWindow)
  - src/app.ts (middleware registration before auth)
  - test/middleware/rate-limit.test.ts (new, 8 tests)
```

**Step 4: Review before commit**

```
you > /diff

  src/utils/rate-limiter.ts   NEW   Token bucket. Clean. resetAt logic correct.
  src/middleware/rate-limit.ts NEW   Extracts user ID before IP. Correct order.
  src/core/config.ts          MOD   3 new fields with defaults. Type-safe.
  src/app.ts                  MOD   Middleware registered before auth. Correct.
  test/middleware/rate-limit.test.ts NEW 8 tests. Covers happy path + limits.

  WARN: No test for the Retry-After header value specifically. Worth adding.
  NIT:  Config field names are verbose. rateLimitPerUser could be rateLimit.user.

  LOOKS GOOD — ready to ship with optional Retry-After test addition.

you > /ship

  Summary of changes: Add token-bucket rate limiting middleware
  - 100 req/min for authenticated users, 20/min per IP for unauthenticated
  - In-memory store, Retry-After header on 429
  - 8 new tests, all passing

  Suggested commit message:
  feat: add rate limiting middleware (100/min auth, 20/min anon)
```

**Step 5: Land it**

```
you > /land-and-deploy

Pushing feat/rate-limiting to origin...
PR #42 created: https://github.com/owner/repo/pull/42

Waiting for CI checks...
  ✓ test (Node.js 22) — 2m 18s
  ✓ lint — 41s

Merging PR #42...
Merged: 9f3a2c1
Branch deleted: origin/feat/rate-limiting

Landed: feat/rate-limiting → main
```

`/ship` commits. `/land-and-deploy` lands. That's the full loop from ticket to main.

---

## Debugging a bug

The bug report: "Logout sometimes fails silently. User stays logged in."

**Step 1: Investigate root cause**

```
you > /investigate why does logout sometimes fail silently?

  Investigating...

  Evidence trail:
  1. src/api/auth.ts:83 — logout() calls session.destroy() but doesn't await it
  2. session.destroy() is async (returns Promise<void>)
  3. The response is sent on line 86 before destroy() settles
  4. If destroy() throws (e.g., Redis connection timeout), the error is swallowed
     because there's no try/catch and the response already went out

  Root cause: session.destroy() called without await. Error path silent.
  Line: src/api/auth.ts:83

  Suggested fix:
    await session.destroy();
    // or handle the error explicitly
```

**Step 2: Fix it**

```
you > /debug src/api/auth.ts

  Reproducing: wrote a test that forces session.destroy() to reject.
  Current: test passes (logout returns 200 even when destroy fails)
  Expected: test should show the bug first, then we fix it.

  [Red] Added test: "logout returns 500 when session.destroy throws"
  npm test: FAIL (confirms the bug)

  [Green] Fixed src/api/auth.ts:83
    - before: session.destroy()
    + after:  await session.destroy()
    Added try/catch, returns 500 on error with 'logout_failed' code.

  [Verify] npm test: PASS (24 tests)

  Debug log saved: .phase2s/debug/2026-04-04-auth-logout.md
```

---

## Code review before commit

You've been working on a chunk of code. Before you commit, you want a second opinion.

```
you > /diff

  Reviewing uncommitted changes...

  src/core/conversation.ts   MOD
    + save() now accepts optional mode parameter for file permissions
    LOOKS GOOD — mode parameter correctly passed to writeFile options

  src/providers/codex.ts     MOD
    + _signalHandlersRegistered guard added to prevent duplicate handlers
    WARN: Guard flag is module-level. If tests re-import the module, the flag
    persists across test files. Worth checking test isolation.

  src/cli/index.ts           MOD
    + loadLearnings() called at startup
    + Learnings injected into Agent constructor
    NIT: interactiveMode and oneShotMode both call loadLearnings() separately.
    Extract to shared setup function to keep them in sync.

  NEEDS REVIEW — address the WARN before shipping.
```

Fix the warning, then run `/review` on just the modified file:

```
you > /review src/providers/codex.ts

  WARN: _signalHandlersRegistered is a module-level flag. In tests that
        reimport the module via vi.resetModules(), the flag resets and handlers
        can re-register. Consider exporting a resetForTesting() helper,
        or document that this module should not be re-imported.

  NIT: The guard comment says "prevent MaxListenersExceededWarning" but
       doesn't mention the vitest-specific cause. Future contributor won't
       know why this is needed.

  Ready to commit after addressing the WARN.
```

---

## Weekly rhythm

End of the week. Before you close your laptop.

**Check what you shipped:**

```
you > /retro

  Last 7 days (2026-03-28 to 2026-04-04):

  Velocity:
    Commits: 14
    Files changed: 38
    Tests added: 52 (was 153, now 205)
    Bug fixes: 3
    Features: 4

  Patterns:
    - Heaviest churn: src/core/agent.ts (touched in 6 commits)
    - Test-to-feature ratio this week: 1.8x (healthy)
    - No commits on Tuesday or Wednesday

  Improvement focus:
    agent.ts is your highest-churn file. Consider extracting the satori loop
    into its own module before it gets harder to test in isolation.
```

**Save a baseline health score:**

```
you > /health

  Running checks...
  tsc --noEmit: PASS
  npm test: PASS (205 tests)
  eslint: 2 warnings (no errors)
  knip: 1 unused export (src/utils/old-helpers.ts)

  Score: 8.4 / 10
  Tests: 10/10, Types: 9/10, Lint: 7/10, Dead code: 7/10

  Trend: 7.8 → 8.1 → 8.4 (improving)
  History saved: .phase2s/health/history.jsonl
```

**Save a checkpoint for Monday:**

```
you > /checkpoint

  Branch: feat/rate-limiting
  Recent: 14 commits this week, rate limiting shipped
  Decisions:
    - In-memory store for now, Redis in backlog
    - 100 req/min auth, 20/min anon (per spec)
  Remaining: /diff flagged Retry-After test missing
  Next: Add Retry-After test, then merge

  Saved: .phase2s/checkpoints/2026-04-04-17-30.md
```

Monday morning:

```bash
phase2s --resume
```

```
Resuming session from .phase2s/sessions/2026-04-04.json (31 messages)
Learnings: 3 entries from .phase2s/memory/

you >
```

Full context. Your last message is still there. The checkpoint file tells you exactly where you left off.

---

## Onboarding a new project to Phase2S

You've cloned a repo you haven't worked in before. Or you're setting up Phase2S on a project you've worked on for a while.

**Step 1: Get a baseline**

```
you > /health

  Running checks...
  tsc: 14 errors
  npm test: FAIL (3 failing tests)
  eslint: 47 warnings, 2 errors
  knip: 12 unused exports

  Score: 3.9 / 10
  Tests: 5/10, Types: 2/10, Lint: 4/10, Dead code: 3/10

  First run — no trend yet. History saved.
```

Good. Now you know the baseline. Every future `/health` run will show you whether you're improving.

**Step 2: Save project conventions**

```
you > /remember
assistant > What should I remember?
you > This project uses pytest, not unittest. Run pytest tests/ to run the test suite.
assistant > Type?
you > tool
assistant > Saved 'test-runner' to .phase2s/memory/learnings.jsonl.

you > /remember
assistant > What should I remember?
you > Always run npm run build before pytest — the tests import compiled JS via a node subprocess.
assistant > Type?
you > pattern
assistant > Saved 'build-before-test' to .phase2s/memory/learnings.jsonl.
```

Next session:

```
Phase2S v1.0.0
Learnings: 2 entries from .phase2s/memory/
```

Phase2S now knows your test runner and build order. You don't have to explain it again.

**Step 3: Run a security baseline**

```
you > /audit

  Phase 1: Secrets scan
    CRIT: OPENAI_API_KEY hardcoded in src/config/defaults.ts:12
          (sk-test-...) — looks like a test key but still shouldn't be committed

  Phase 2: Dependencies
    HIGH: lodash@4.17.20 — known prototype pollution (CVE-2021-23337)
          Recommended: upgrade to 4.17.21

  Phase 3: Input validation
    MED: src/api/search.ts:34 — query parameter passed to SQL without sanitization
         Not exploitable if using parameterized queries (confirm)

  Phase 4: Shell command safety
    PASS — allowDestructive is false, shell tool blocks rm -rf and sudo

  3 findings. Fix CRIT first.
```

---

## Creating a custom skill

You find yourself typing the same long prompt repeatedly: "summarize the git diff in plain English for a non-technical reviewer." Make it a skill.

```
you > /skill

assistant > What should this skill do? One sentence.
you > Summarize the current git diff in plain English for a non-technical reviewer.

assistant > What phrases trigger this skill? Give 3-5 examples.
you > summarize changes, explain the diff, PR summary, what changed in plain English,
      summarize for review

assistant > Which model tier? default, fast, or smart?
you > smart

assistant > Skill '/diff-summary' created at .phase2s/skills/diff-summary/SKILL.md
           Run `phase2s skills` to verify it loaded.
```

Now:

```
you > /diff-summary

  This change adds rate limiting to the API. When too many requests arrive
  in a short window, the server now sends back a "slow down" response (HTTP 429)
  instead of processing them all. Authenticated users get a higher limit (100
  per minute) than anonymous visitors (20 per minute). The code includes 8 new
  automated tests confirming the limits work correctly.
```

That's the full skill creation loop — from nothing to a working `/command` in 30 seconds.

---

## Running skills automatically in CI

Everything above happens in your terminal when you think to ask. The GitHub Action makes it automatic.

Create `.github/workflows/phase2s.yml` in your repo:

```yaml
name: Phase2S

on:
  pull_request:

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: scanton/phase2s@v1
        with:
          skill: review
          provider: anthropic
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

When you open a PR, the action runs `/review` and posts the output as a PR comment. You see the review before you merge — without having to remember to ask.

If you want it to actually block a merge when something's wrong, use `/adversarial` with `fail-on: challenged`:

```yaml
- uses: scanton/phase2s@v1
  with:
    skill: adversarial
    provider: anthropic
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    fail-on: challenged
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

The action fails (red X on the PR) if `/adversarial` raises a challenge. Then you either address it or override. This turns Phase2S from "tool you use when you remember" into "gate that runs every time."

Full reference: [GitHub Action docs](github-action.md).
