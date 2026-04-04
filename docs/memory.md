# Memory and Persistence

Phase2S has two kinds of memory: session persistence (resuming conversations) and persistent project memory (saving things you want to remember across every session). This page covers both, plus the `/skill` meta-skill and everything Phase2S writes to disk.

---

## Session persistence

Every conversation saves automatically to `.phase2s/sessions/YYYY-MM-DD.json` after every turn. You don't need to do anything.

**Resume your last session:**

```bash
phase2s --resume
```

```
Resuming session from .phase2s/sessions/2026-04-04.json (14 messages)

you >
```

Everything is there: every message you sent, every model response, every tool call result. Hit `Ctrl+C` mid-session and Phase2S saves before exiting so you don't lose the turn in progress.

**What gets saved:**

- Your messages
- The model's responses
- Every tool call: file reads, shell commands, glob searches, grep results
- The full conversation history the model had access to

**What does not get saved:**

- System prompt (regenerated fresh each session, with current learnings injected)
- The model's internal reasoning (only the final response)

**One session file per day.** If you run Phase2S multiple times on the same day, all turns go into the same file. `--resume` always loads the most recent session file.

**Session files are private.** Written with `mode: 0o600` (owner-read/write only). On shared machines, your conversation history is not world-readable.

---

## Persistent memory

Session persistence restores your conversation. Persistent memory is different: it's specific facts and preferences you want Phase2S to know at the start of every future session.

Memory is explicit. You decide what gets saved. There's no auto-capture that fills up with noise.

### How it works

1. You run `/remember` and tell Phase2S what to save
2. Phase2S appends a JSON line to `.phase2s/memory/learnings.jsonl`
3. Next session startup: Phase2S loads the file and injects learnings into the system prompt

```
Phase2S v0.12.0
Learnings: 3 entries from .phase2s/memory/
```

The model reads your learnings before your first message. It knows your project conventions without you re-explaining them.

### Running `/remember`

```
you > /remember

assistant > What should I remember? Give me one specific insight.
you > This project uses vitest, not jest. The test command is npm test.

assistant > What type is this? preference, decision, pattern, constraint, or tool?
you > preference

assistant > Saved learning 'test-framework' to .phase2s/memory/learnings.jsonl.
           It will be loaded at the start of every future session.
```

You can also trigger it inline:

```
you > remember this: always run npm run build before running tests in this repo
```

### What to remember

**Preferences** — tooling choices, test frameworks, coding conventions:
```
This project uses vitest, not jest. Run: npm test
We use Zod for schema validation, not Yup
Prettier is configured with printWidth: 100, no semi
```

**Decisions** — why you chose something, so future sessions don't relitigate it:
```
We chose in-memory rate limiting (not Redis) because this is a single-instance deploy.
We're deferring pagination until the search endpoint hits performance issues.
Auth uses JWTs with 1-hour expiry. Refresh tokens in backlog.
```

**Patterns** — build order, setup steps, quirks:
```
Always run npm run build before running tests — tests import compiled JS
The dev server needs port 3001 free — 3000 is taken by another service
Integration tests require DATABASE_URL to be set, even in CI
```

**Constraints** — machine-specific paths and configs:
```
The codex binary is at /opt/homebrew/bin/codex on this machine
Node version must be 20.x — 22 breaks the native addon in src/native/
```

**Tools** — CLI preferences:
```
Use fd not find — it respects .gitignore
Use jq for JSON in shell commands
ripgrep (rg) is installed, prefer it over grep for codebase search
```

### What learnings.jsonl looks like

```json
{"id":"test-framework","type":"preference","content":"This project uses vitest, not jest. The test command is npm test.","savedAt":"2026-04-04T14:23:11Z"}
{"id":"build-before-test","type":"pattern","content":"Always run npm run build before running tests — tests import compiled JS via a node subprocess.","savedAt":"2026-04-04T14:25:03Z"}
```

Plain JSONL. One entry per line. Edit it manually if you need to remove or update a learning.

### Context limit

Phase2S injects up to 2000 characters of learnings into the system prompt. If your learnings file exceeds that, Phase2S uses the most recent entries and trims oldest first.

---

## The `/skill` meta-skill

`/skill` lets you create new Phase2S skills from inside Phase2S. Three questions, then it writes the SKILL.md. No YAML editing required.

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

The new skill is immediately available in the same session. No restart needed.

What it creates (`.phase2s/skills/diff-summary/SKILL.md`):

```markdown
---
name: diff-summary
description: Summarize the current git diff in plain English for a non-technical reviewer.
model: smart
triggers:
  - summarize changes
  - explain the diff
  - PR summary
  - what changed in plain English
  - summarize for review
---

Run `git diff HEAD` to get the current uncommitted changes.
Summarize them in plain English for a non-technical reviewer.
Focus on what changed functionally, not the code details.
Keep it to 3-5 sentences. Mention the number of tests changed if any.
```

See [writing-skills.md](writing-skills.md) for the full SKILL.md format.

---

## What Phase2S writes to disk

Everything goes to `.phase2s/` inside your project directory. Nothing writes outside it.

| Path | What's there | When it's created |
|------|-------------|-------------------|
| `.phase2s/sessions/YYYY-MM-DD.json` | Full conversation history (tool calls included) | After every turn |
| `.phase2s/memory/learnings.jsonl` | Persistent learnings from `/remember` | When you run `/remember` |
| `.phase2s/skills/<name>/SKILL.md` | Custom skills from `/skill` | When you run `/skill` |
| `.phase2s/context/<ts>-<slug>.md` | Satori context snapshot (git branch, commits, diff, task) | Before every `/satori` run |
| `.phase2s/satori/<slug>.json` | Satori attempt log (attempt #, pass/fail, failure lines) | After every `/satori` run |
| `.phase2s/specs/<date>-<slug>.md` | Spec from `/deep-specify` (Intent, Boundaries, Success criteria) | After `/deep-specify` completes |
| `.phase2s/debug/<slug>.md` | Debug session log | After `/debug` completes |
| `.phase2s/checkpoints/<ts>.md` | Session state snapshot from `/checkpoint` | When you run `/checkpoint` |
| `.phase2s/health/history.jsonl` | Health score history | After every `/health` run |
| `.phase2s/retro/<date>.md` | Retro report | After every `/retro` run |

**All session files use `mode: 0o600` (owner-read/write only).** This applies to conversation history. Other files (specs, checkpoints, debug logs) use standard file permissions since they're meant to be shared with your team.

**.phase2s/ belongs in your repo.** Commit skills, memory, and specs. Keep sessions in `.gitignore` if you don't want conversation history in version control.
