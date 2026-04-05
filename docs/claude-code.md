# Claude Code + Phase2S: Cross-Model Adversarial Review

If you use Claude Code as your daily driver, this is the most immediately useful thing Phase2S does for you.

Claude Code is good. But it's one model. When Claude reviews Claude's own plan, it's working with the same training, the same biases, the same blind spots. It tends to agree with itself.

Phase2S plugs into Claude Code as an MCP server. This gives Claude a tool — `phase2s__adversarial` — that sends a plan to GPT (running on your ChatGPT subscription) and gets back a structured challenge. Two different models, different training, different failure modes, working on the same plan. When both agree, you can proceed with more confidence. When they disagree, you find out before you've written a thousand lines of code.

---

## What you need

- Phase2S installed: `npm install -g @scanton/phase2s`
- Codex CLI installed and authenticated with your ChatGPT account:
  ```bash
  npm install -g @openai/codex
  codex auth
  ```
  `codex auth` opens a browser window. Log in with the same account you use at [chat.openai.com](https://chat.openai.com). You do this once — Codex saves a token and reuses it.
- Claude Code with a project open
- A `.claude/settings.json` file in your project (see Setup below)

**No API key required.** Phase2S uses your ChatGPT subscription for all AI work.

---

## Setup (2 minutes)

**Step 1: Create `.claude/settings.json` in your project root**

If the `.claude/` directory doesn't exist yet, create it:

```bash
mkdir -p .claude
```

Then create the file:

```json
{
  "mcpServers": {
    "phase2s": {
      "command": "phase2s",
      "args": ["mcp"]
    }
  }
}
```

That's the whole file. Claude Code reads it when you open the project and automatically starts `phase2s mcp` as a background process. You don't run anything manually. Phase2S starts when Claude Code starts and stops when Claude Code stops.

**Step 2: Open or reload the project in Claude Code**

Close and reopen your project folder in Claude Code. The Phase2S MCP server starts automatically. You'll see all 29 Phase2S skills available as tools (prefixed with `phase2s__`).

**Step 3: Add routing rules to CLAUDE.md**

Claude Code needs to know when to reach for Phase2S tools. Add a `CLAUDE.md` file to your project root (or update the existing one) with instructions:

```markdown
## Phase2S tools

Phase2S is running as an MCP server. Use its tools proactively:

- Before executing any significant plan, call `phase2s__adversarial` with the plan
  text as `prompt`. Read the VERDICT field. If CHALLENGED, address OBJECTIONS before
  proceeding. Do not call `codex exec` directly — it requires browser auth and fails
  silently. Always use `phase2s__adversarial` instead.

- For engineering plan review, call `phase2s__plan_review`.
- For scope ambiguity, call `phase2s__scope_review`.
- For code quality checks, call `phase2s__health`.
```

This tells Claude to use `phase2s__adversarial` automatically when it writes a plan, without you having to ask.

---

## How adversarial review works

When Claude Code calls `phase2s__adversarial`, it passes the plan text. Phase2S runs it through GPT (via your ChatGPT subscription) using the `/adversarial` skill, which is specifically designed for AI-to-AI use: no interactive questions, no back-and-forth, just a structured verdict.

The output always looks like this:

```
VERDICT: CHALLENGED

STRONGEST_CONCERN: The token bucket resets per-request rather than per-window.

OBJECTIONS:
1. RateLimiter.check() increments the counter and resets the bucket lazily on
   the first request after the window expires. This means a client can always
   make one free request immediately after being throttled. The window reset
   should happen on a fixed schedule, not on demand.

2. The middleware is registered after the auth middleware in app.ts line 34.
   Unauthenticated requests hit the auth check before they hit rate limiting,
   which means they bypass rate limiting entirely if auth fails fast.

3. The Retry-After header is set to a hardcoded 60 but should reflect the
   actual time remaining until the window resets.

APPROVE_IF: Fix the window reset to be time-based not request-based; move
middleware before auth; compute Retry-After from the actual reset timestamp.
```

**VERDICT: APPROVED** — no blocking objections. Claude proceeds.

**VERDICT: CHALLENGED** — specific, actionable objections. Claude surfaces them to you and waits. You decide whether to address them or override.

**VERDICT: NEEDS_CLARIFICATION** — the plan is ambiguous in ways that affect correctness. Claude asks you for the missing context before going further.

The objections are concrete and falsifiable. Not "this could be improved" but "line 34, this specific behavior, this specific consequence." If you disagree with an objection, you can tell Claude to proceed and explain why — you always have the final call.

---

## What Claude Code sees

Once Phase2S is running as an MCP server, Claude Code gets a tool for every Phase2S skill:

| Phase2S skill | Claude Code tool name |
|---|---|
| `phase2s goal` | `phase2s__goal` |
| `phase2s report` | `phase2s__report` |
| `/adversarial` | `phase2s__adversarial` |
| `/plan-review` | `phase2s__plan_review` |
| `/consensus-plan` | `phase2s__consensus_plan` |
| `/scope-review` | `phase2s__scope_review` |
| `/health` | `phase2s__health` |
| `/review` | `phase2s__review` |
| `/audit` | `phase2s__audit` |
| `/remember` | `phase2s__remember` |
| `/retro` | `phase2s__retro` |
| (all 29) | `phase2s__<name>` |

Hyphens become underscores: `plan-review` → `phase2s__plan_review`.

Claude Code can call any of these on your behalf. The most commonly useful ones:

- `phase2s__adversarial` — challenge a plan before executing it
- `phase2s__health` — check code quality after finishing a sprint
- `phase2s__scope_review` — validate that a feature's scope is right before writing code
- `phase2s__remember` — save a project convention so future sessions know about it

---

## Example session

Here's what a real session looks like with Phase2S configured:

```
you: Add rate limiting to the API. Use a token bucket, 100 req/min for
     authenticated users, 20/min per IP for unauthenticated.

Claude: I'll plan this out before implementing.

[Calls phase2s__adversarial with the plan...]

phase2s__adversarial result:
VERDICT: CHALLENGED
STRONGEST_CONCERN: Window reset is lazy (per-request) not fixed-schedule.
OBJECTIONS:
1. Lazy reset means clients get one free request after every throttle period.
2. Middleware registration order: rate limiting must run before auth, not after.
APPROVE_IF: Fix window reset to time-based; move middleware before auth.

Claude: The adversarial review raised two issues I need to address:

1. I was planning to reset the bucket on the first request after the window
   expires. That gives every client one free over-limit request. The correct
   approach is a fixed-interval reset using setInterval or a resetAt timestamp
   checked on every request.

2. I had middleware registration after auth. That means unauthenticated users
   bypass rate limiting entirely. Middleware needs to go before auth.

Updated plan: [revised plan with fixes]

Should I proceed with the updated approach?
```

Claude caught both issues before writing a single line of code.

---

## Triggering the dark factory from Claude Code

Phase2S v1.2.0 adds `phase2s__goal` — Claude Code can now run the dark factory directly, without you touching a terminal.

```
you: Build the pagination spec at .phase2s/specs/2026-04-04-pagination.md

Claude: [Calls phase2s__goal with specFile and reviewBeforeRun: true]

phase2s__goal result:
Goal run: success
Spec: .phase2s/specs/2026-04-04-pagination.md
Attempts: 2
Criteria: 3/3 passed
Run log (absolute): /your/project/.phase2s/runs/2026-04-05T12-00-00-a1b2c3d4.jsonl

Claude: Done. All three acceptance criteria passed after 2 attempts. The run
log shows the cursor logic took an extra satori retry on attempt 1 — the
resetAt logic was off by one. Fixed on retry. Do you want me to read the full
run log?
```

`phase2s__goal` is long-running — dark factory runs can take 20+ minutes for large specs. When you ask Claude to build a spec, Claude starts the tool call and waits. You can do other things; Claude Code will surface the result when it finishes.

**What Claude gets back:**
- A one-line run summary
- Attempt count and criteria pass/fail ratio
- The **absolute path** to the structured JSONL run log — Claude can call `phase2s__report` with that path to get a formatted summary, or `file_read` for raw JSONL

**Parameters:**
- `specFile` (required) — path to the spec `.md` file
- `reviewBeforeRun` (optional, boolean) — run adversarial review before execution; challenged specs stop before any code is written
- `notify` (optional, boolean) — send a notification on completion via all configured channels (`notify.slack`, `notify.discord`, `notify.teams` in `.phase2s.yaml`, or the corresponding env vars)

**With adversarial pre-check:**

```
you: Run .phase2s/specs/new-feature.md with adversarial review

Claude: [Calls phase2s__goal with reviewBeforeRun: true]

phase2s__goal result:
Goal run: challenged
Spec: .phase2s/specs/new-feature.md
Attempts: 0

Adversarial review response:
VERDICT: CHALLENGED
STRONGEST_CONCERN: No sub-task handles the database migration.
OBJECTIONS:
1. The spec adds a new column but has no sub-task for the migration script.
   The acceptance criteria can't pass on a fresh database without it.
APPROVE_IF: Add a sub-task: "Write and run migration for new_column".

Claude: The spec was challenged before any code ran. The reviewer flagged a
missing migration sub-task. Want me to update the spec and re-run?
```

---

## Adding custom skills that Claude Code can use

Any skill you add to `.phase2s/skills/` in your project automatically becomes a Claude Code tool at next server start.

For example, if your project has a deployment step that isn't covered by the built-in `/ship` skill, you can write a `.phase2s/skills/deploy-staging/SKILL.md`:

```yaml
---
name: deploy-staging
description: Deploy the current branch to staging and verify health checks
model: smart
triggers:
  - deploy staging
  - push to staging
---

Deploy the current branch to staging:
1. Run `npm run build`
2. Run `git push origin HEAD:staging`
3. Wait for the deploy webhook (check .phase2s/deploy-status.json)
4. Run `npm run health-check:staging`
5. Report pass/fail with the health check URL
```

Save it, restart Claude Code's MCP server (close and reopen the project), and Claude Code now has `phase2s__deploy_staging` available as a tool.

---

## Troubleshooting

**"No tool named phase2s__adversarial" or tools aren't showing**

1. Check `.claude/settings.json` exists in your project root (not home directory)
2. Verify `phase2s` is in PATH: `which phase2s`
3. Try reloading the project in Claude Code
4. Run `phase2s mcp` manually in a terminal to see if it starts without errors

**"phase2s__adversarial returned an error"**

Usually means Codex isn't authenticated. Run `codex auth` in a terminal. The browser login saves a token that Phase2S uses — this token expires occasionally and needs to be refreshed.

**Claude Code calls `codex exec` directly instead of `phase2s__adversarial`**

Add this to your `CLAUDE.md`:

```markdown
NEVER run `codex exec` or `codex review` directly for adversarial review.
Codex CLI requires browser OAuth and fails in automated contexts.
ALWAYS use `phase2s__adversarial` instead.
```

Claude Code reads CLAUDE.md before every session and will follow it.

**MCP server notes**

Each tool call is stateless — a fresh agent is created for each invocation. Multi-turn conversation history doesn't persist across MCP calls. If you need conversation continuity, use the Phase2S REPL directly.

If you create a new skill during a REPL session, it won't appear as a Claude Code tool until you restart the MCP server (close and reopen the project in Claude Code).
