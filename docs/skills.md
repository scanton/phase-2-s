# Skills Reference

Phase2S ships with 29 built-in skills. Every skill works with Option A (ChatGPT subscription via Codex CLI). Model tier routing (`fast_model` / `smart_model`) works with any direct API provider — Options B, C, D, E, or F.

Invoke any skill from the REPL:

```
you > /review src/core/agent.ts
you > /satori add rate limiting to the API
you > /diff
```

List all loaded skills (built-in + custom):

```bash
phase2s skills
```

Each skill shows its name, description, and model tier badge (`[fast]` or `[smart]`). Skills without a declared tier use the default model.

Search by name or description:

```bash
phase2s skills quality      # → /health, /qa, /audit
phase2s skills security     # → /audit
phase2s skills deploy       # → /ship, /land-and-deploy
```

For machine-readable output (useful in scripts):

```bash
phase2s skills --json
phase2s skills --json security   # filter + JSON combined
```

Returns a JSON array with `name`, `description`, `model`, and `inputs` for every skill. Pipe into `jq`:

```bash
# List all fast-tier skills
phase2s skills --json | jq '.[] | select(.model=="fast") | .name'

# Skills with inputs
phase2s skills --json | jq '.[] | select(.inputs != null) | .name'
```

To preview skill routing without executing (useful when debugging `fast_model`/`smart_model` config):

```bash
phase2s run --dry-run "/explain src/core/agent.ts"
# → Would route to skill: explain (model: gpt-4o-mini)
```

### ZSH shorthand

After running `phase2s setup`, you can invoke skills from any terminal prompt without opening the REPL:

```bash
: fix the null check in auth.ts
: what does this codebase do?
p2 suggest "find large log files"
```

The `:` command maps to `phase2s run`. The `p2` alias is equivalent. See [getting-started.md](getting-started.md#shell-integration-zsh--optional-but-recommended) for setup instructions.

---

## Persistent execution

### `/satori`

Persistent execution until verified complete. This is the most powerful skill in Phase2S.

Runs your task, then immediately runs `npm test` (or your configured `verifyCommand`). If tests fail, it injects the exact failure output back into the conversation and tries again. Up to 3 attempts. It stops when the tests are green, not when the model thinks it's done.

```
you > /satori add rate limiting to the API middleware

Running /satori on: add rate limiting to the API middleware...
[Context snapshot written to .phase2s/context/]

-- Attempt 1 --
[agent implements rate limiting]
Verification: npm test
  FAIL api.test.ts
    ✗ rate limiter: allows burst then throttles (expected 429, got 200)

-- Attempt 2 --
[agent reads failure, identifies the bug, fixes the window logic]
Verification: npm test
  PASS (12 tests)

assistant > Rate limiting implemented. 2 attempts. First attempt missed the
           sliding window reset logic — the bucket wasn't cleared between
           requests in the same window. Fixed in attempt 2.
```

Writes to disk: `.phase2s/context/<ts>-<slug>.md` (context snapshot before the run), `.phase2s/satori/<slug>.json` (attempt log with pass/fail and failure lines).

Uses `smart_model` tier if configured. See [advanced.md](advanced.md) for model routing.

**Arguments:**
```
/satori add pagination to the search endpoint
/satori fix the flaky auth tests
/satori src/api/middleware.ts — focus on a specific file
```

**Configure the verify command:**
```yaml
# .phase2s.yaml
verifyCommand: "npm test -- --run"
# verifyCommand: "pytest tests/"
# verifyCommand: "go test ./..."
```

---

### `/consensus-plan`

Consensus-driven planning. Runs three internal passes before producing a plan:

1. **Planner** — concrete, ordered implementation plan with dependencies
2. **Architect** — structural review, edge cases, test coverage gaps
3. **Critic** — adversarial challenge of assumptions and production risks

If the Critic finds real objections, the loop restarts with the objections as new constraints (up to 3 iterations). Output is one of: `APPROVED`, `APPROVED WITH CHANGES`, `REVISE`.

Use this before starting any non-trivial feature. It catches plan errors that only show up in implementation.

```
you > /consensus-plan add auth middleware
```

Works with all providers. Model routing (using `smart_model` for the critic pass) requires a direct API provider — Options B, C, D, E, or F.

---

### `/adversarial`

Cross-model adversarial review. Designed for AI-to-AI invocation via Claude Code MCP, but works fine manually too.

Paste a plan or decision. Get back a machine-readable verdict:

```
VERDICT: CHALLENGED | APPROVED | NEEDS_CLARIFICATION
STRONGEST_CONCERN: [one sentence, specific and citable]
OBJECTIONS:
1. [specific, falsifiable objection]
2. [specific, falsifiable objection]
3. [optional]
APPROVE_IF: [what would need to change]
```

No interactive questions. No soft language. Specific objections only.

```
you > /adversarial
[paste the plan you want challenged]
```

When Claude Code calls `phase2s__adversarial` via MCP, Phase2S (GPT-4o) challenges Claude's plan. Different model, different training, no stake in agreeing. See [claude-code.md](claude-code.md) for the full MCP setup.

---

## Execution skills

### `/debug`

Systematic debugging end-to-end. Reproduce the bug, isolate the smallest failing case, form root cause hypotheses, implement the fix, verify with tests.

Different from `/investigate` (which traces root cause only) — `/debug` goes all the way to a verified fix.

Saves a debug log to `.phase2s/debug/`.

```
you > /debug src/core/agent.ts
you > /debug the REPL sometimes drops the last message
```

---

### `/tdd`

Test-driven development. Red (write failing tests) → Green (minimal implementation) → Refactor (clean up).

Detects your test framework from `package.json`. Reports coverage delta after each phase.

```
you > /tdd src/auth.ts "reject expired tokens"
you > /tdd src/api/search.ts "return paginated results"
```

---

### `/slop-clean`

Anti-slop refactor pass. Five-smell taxonomy, one category at a time:

1. Dead code
2. Duplication
3. Needless abstraction
4. Boundary violations
5. Missing tests

Runs a baseline test pass before any changes. Tests after each smell category. Safe to run on any codebase.

```
you > /slop-clean src/tools/
you > /slop-clean src/core/agent.ts
```

---

### `/deep-specify`

Structured spec interview before any code is written. Starts with three tech stack questions (language/runtime, framework, deployment target) so the spec's constraint section is grounded in your actual environment. Then identifies the 3-5 highest-risk ambiguities and asks Socratic questions one at a time, synthesizing all answers into a spec with:

- Intent
- Boundaries
- Non-goals
- Constraints (including `Tech Stack` from the discovery phase)
- Success criteria

Saves to `.phase2s/specs/`. Ends with a pointer to `/plan` or `/autoplan`.

```
you > /deep-specify
you > /deep-specify add OAuth login
```

Run this before any feature you're not 100% clear on. You'll catch assumptions before they become bugs.

---

### `/docs`

Inline documentation generation. Writes JSDoc/TSDoc into the code itself, not an explanation to you.

Priority order: public API first (full `@param`/`@returns`/`@throws`/`@example`), then complex logic inline comments, then interface field annotations, then module headers. Runs `tsc --noEmit` after to catch annotation errors.

```
you > /docs src/core/agent.ts
you > /docs src/tools/
```

---

## Code review and analysis

### `/review`

Code review with structured severity tagging:

- `CRIT` — must fix before shipping
- `WARN` — should fix, won't break immediately
- `NIT` — style and minor improvements

```
you > /review src/core/agent.ts
you > /review src/core/ src/cli/
```

---

### `/investigate`

Root cause debugging. Traces evidence to the exact line. Stops at root cause — does not implement a fix. Use `/debug` if you want the fix too.

```
you > /investigate why does the REPL exit after the second tool call?
you > /investigate src/providers/openai.ts
```

---

### `/diff`

Reviews your uncommitted changes. What changed per file, why it probably changed, risk assessment, test coverage gaps. Ends with a clear verdict:

- `LOOKS GOOD`
- `NEEDS REVIEW`
- `RISKY`

```
you > /diff
```

No arguments needed — it reads your git working tree.

---

### `/audit`

Security audit. Four phases:

1. Secrets in code and git history
2. Dependency vulnerabilities (`npm audit`)
3. Input validation and injection paths
4. File sandbox and shell command safety review

Each finding includes: severity (CRIT/HIGH/MED/LOW), confidence (VERIFIED/UNVERIFIED), and an exploit scenario.

```
you > /audit
you > /audit src/tools/
```

---

### `/health`

Code quality dashboard. Auto-detects your tooling (tsc, vitest/jest, eslint, knip). Runs each check. Scores on a weighted 0-10 rubric:

- Tests: 40%
- Types: 25%
- Lint: 20%
- Dead code: 15%

Shows trend across last N runs. Persists history to `.phase2s/health/history.jsonl`. Reports only — does not fix.

```
you > /health
```

---

### `/explain`

Explains code or a concept in plain language. Follows the code top-to-bottom, explains intent not just mechanics.

```
you > /explain src/core/agent.ts
you > /explain what is the difference between a tool call and a function call in OpenAI's API?
```

---

## Planning and shipping

### `/plan`

Phased implementation plan with verify steps per phase. Concrete and ordered.

Saves to `.phase2s/plans/YYYY-MM-DD-HH-MM-<slug>.md`. Multiple plans in the same day get their own timestamped file.

```
you > /plan add rate limiting to the API middleware
you > /plan migrate the database from SQLite to Postgres
```

---

### `/plan-review`

Engineering plan review. Six sections:

1. Scope validation
2. Architecture critique
3. Code quality assessment
4. Test coverage map (ASCII diagram: which paths are tested vs. not)
5. Performance flags
6. One adversarial outside challenge

Ends with: `APPROVE` / `APPROVE WITH CHANGES` / `REVISE AND RESUBMIT`.

```
you > /plan-review
[paste the plan]
```

---

### `/scope-review`

Scope and ambition challenge. Four modes:

- **Expand** — what's the 10x version of this?
- **Hold** — max rigor on stated scope
- **Reduce** — strip to essentials
- **Challenge** — adversarial: what's wrong with the premise?

Different from `/plan-review` which focuses on implementation quality. This one asks whether you're solving the right problem at the right scale.

```
you > /scope-review
you > /scope-review Expand add auth to the API
```

---

### `/autoplan`

Orchestrates `/scope-review` + `/plan-review` in sequence with defined auto-decision principles:

- Prefer completeness
- Fix blast radius
- Cleaner architecture wins
- Eliminate duplication
- Explicit over clever
- Bias toward action

Surfaces only taste decisions and user challenges at the end. Less back-and-forth than running both skills manually.

```
you > /autoplan add a search endpoint to the API
```

---

### `/ship`

Commit prep. Runs: diff review, secret scan, formatted commit message suggestion. Stops at the commit.

```
you > /ship
```

---

### `/land-and-deploy`

Push, open a PR, merge it, wait for CI, and confirm the land. Picks up where `/ship` leaves off.

Requires the `gh` CLI installed and authenticated (`gh auth status`).

```
you > /land-and-deploy

Pushing feat/rate-limiting to origin...
PR #42 created: https://github.com/owner/repo/pull/42

Waiting for CI checks...
  ✓ test (Node.js 22) — 2m 14s
  ✓ lint — 43s

Merging PR #42...
Merged: abc1234
Branch deleted: origin/feat/rate-limiting

Landed: feat/rate-limiting → main
```

Handles the common failure paths:
- Uncommitted changes: stops and tells you to run `/ship` first
- Push conflicts (non-fast-forward): stops, explains, does not force-push
- CI failures: shows which check failed and the failure log, stops
- Merge conflicts: stops and tells you to resolve locally

Trigger phrases: `land this`, `merge and deploy`, `land it`, `ship to production`

---

## Memory and meta

### `/remember`

Save a project learning to persistent memory. Stored in `.phase2s/memory/learnings.jsonl`. Injected into every future session automatically — Phase2S knows your project's conventions without re-explanation.

```
you > /remember
assistant > What should I remember? Give me one specific insight.
you > This project uses vitest, not jest. The test command is npm test.
assistant > What type is this? preference, decision, pattern, constraint, or tool?
you > preference
assistant > Saved learning 'test-framework' to .phase2s/memory/learnings.jsonl.
```

Types: `preference`, `decision`, `pattern`, `constraint`, `tool`

See [memory.md](memory.md) for the full persistence model.

---

### `/skill`

Create a new Phase2S skill from inside Phase2S. Three-question interview:

1. What should this skill do?
2. What phrases should trigger it?
3. Which model tier? (default, fast, smart)

Writes a `SKILL.md` to `.phase2s/skills/<name>/SKILL.md`. No manual YAML editing required.

```
you > /skill
```

See [writing-skills.md](writing-skills.md) for the SKILL.md format and how to write skills manually.

---

## Session and workflow

### `/qa`

Functional QA. Edge cases, empty inputs, error paths, bug report. Goes through the feature methodically.

```
you > /qa src/api/search.ts
you > /qa the pagination feature
```

---

### `/retro`

Weekly retrospective. Runs `git log` across the last 7 days, reports velocity (commits, LOC, fix ratio, test ratio), identifies patterns and churn, ends with one concrete improvement focus.

```
you > /retro
```

---

### `/checkpoint`

Saves a structured snapshot of current session state. Infers from git and conversation: branch, recent commits, decisions made, remaining work, next step. Saves to `.phase2s/checkpoints/YYYY-MM-DD-HH-MM.md`.

Complements `--resume` (which restores the full conversation) with a human-readable summary.

```
you > /checkpoint
```

---

## Safety skills

### `/careful`

Safety mode. Pauses before destructive shell commands and asks for confirmation:

- `rm`, `git reset --hard`, `git push --force`
- `DROP TABLE`, `docker rm`, `sudo`

Safe commands (`ls`, `git status`, `npm test`) proceed without prompting.

```
you > /careful
```

---

### `/freeze <dir>`

Restricts file edits to a single directory for the session. Read operations are unrestricted. Enforced via model self-monitoring.

```
you > /freeze src/tools/
```

---

### `/guard`

Full safety mode. Combines `/careful` and `/freeze` in one activation. Destructive command confirmation plus directory-scoped edits.

```
you > /guard src/tools/
```

---

### `/unfreeze`

Clears the edit directory restriction set by `/freeze` or `/guard`.

```
you > /unfreeze
```
