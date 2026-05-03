# Memory and Persistence

Phase2S has two kinds of memory: session persistence (resuming conversations) and persistent project memory (saving things you want to remember across every session). This page covers both, plus the `/skill` meta-skill and everything Phase2S writes to disk.

---

## Session persistence

Every conversation saves automatically to `.phase2s/sessions/<uuid>.json` after every turn. You don't need to do anything.

**Resume your last session:**

```bash
phase2s --resume
```

```
Resuming session (14 messages)

you >
```

Everything is there: every message you sent, every model response, every tool call result. Hit `Ctrl+C` mid-session and Phase2S saves before exiting so you don't lose the turn in progress. Same for rate limits: if the provider returns a 429, Phase2S saves your session — including the message you just sent — before exiting. `--resume` picks up exactly where you stopped.

**What gets saved:**

- Your messages
- The model's responses
- Every tool call: file reads, shell commands, glob searches, grep results
- The full conversation history the model had access to

**What does not get saved:**

- System prompt (regenerated fresh each session)
- The model's internal reasoning (only the final response)

**Session files are private.** Written with `mode: 0o600` (owner-read/write only). On shared machines, your conversation history is not world-readable.

---

## Context compaction

Long sessions accumulate tens of thousands of tokens — tool call results, error messages, multiple satori attempts. At some point the model's context window fills up, responses get expensive, and earlier context gets truncated.

Context compaction replaces the full conversation with an LLM-generated summary covering: files modified, decisions made, errors resolved, and the current goal. A backup of the original conversation is written before anything is replaced.

**Compact on demand:**

```
you > :compact
↻ Compacting session (42k tokens)...
✔ Compacted to 1.2k tokens. Backup: .phase2s/sessions/abc-123.compact-backup-1.json
```

**Compact automatically:**

```yaml
# .phase2s.yaml
auto_compact_tokens: 80000
```

With this set, Phase2S compacts automatically before each turn when the estimated context size meets or exceeds the threshold. After compaction, one turn is skipped before the guard re-checks — this prevents an immediate re-fire if the summary itself is large.

**Backup files:**

Before replacing anything, Phase2S writes a numbered backup to the same sessions directory. If something goes wrong, you can recover your full conversation from `.phase2s/sessions/<uuid>.compact-backup-1.json`. Subsequent compactions write `.compact-backup-2.json`, `.compact-backup-3.json`, etc. — no backup is ever overwritten.

**Checking the summary:**

The compacted summary appears as the first message in the resumed conversation. It starts with `[COMPACTED CONTEXT]` so it's easy to identify. The model has access to this summary for all future turns in the session.

---

## Session branching

Sessions are stored as a DAG — each one knows its parent. This lets you fork any past conversation and explore an alternative direction without losing your original work.

**Browse all past sessions:**

```bash
phase2s conversations
```

Opens an [fzf](https://github.com/junegunn/fzf) browser (or a plain-text table if fzf isn't installed). Each row shows the date, branch name, and a preview of the first message. The session UUID is shown in the preview pane for copying.

**Fork a session:**

```
you > :clone <session-uuid>
Branch name (press Enter for default): feature/different-approach
Cloned abc-123-... → xyz-789-... (14 messages inherited)
Branch: feature/different-approach

you >
```

The forked session starts with a full copy of the parent's messages. Future messages go to the new session file. The original is untouched.

**Migration:** On first launch after upgrading to v1.21.0+, Phase2S automatically migrates legacy date-named sessions to UUID format. A backup is created at `.phase2s/sessions-backup-<date>/` before any files are changed. Migration is resumable — if interrupted, the next launch continues from where it left off.

---

## Persistent memory

Session persistence restores your conversation. Persistent memory is different: it's specific facts and preferences you want Phase2S to know at the start of every future session.

Memory is explicit. You decide what gets saved. There's no auto-capture that fills up with noise.

### How it works

1. You run `/remember` and tell Phase2S what to save
2. Phase2S appends a JSON line to `.phase2s/memory/learnings.jsonl`
3. Before each LLM turn: Phase2S loads your learnings and injects them as a context message just before your prompt — keeping them current if you save new learnings mid-session

```
Phase2S v1.0.0
Learnings: 3 entries from .phase2s/memory/
```

The model sees your learnings before every turn, not just the first one. If you run `/remember` during a session, the very next turn picks up the new learning automatically.

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

### Context limit and semantic retrieval

By default, Phase2S injects up to 2000 characters of learnings, using the most recent entries first.

**With Ollama configured, you get semantic retrieval instead.** Set `ollamaBaseUrl` in `.phase2s.yaml` (even when using the `codex-cli` provider for chat) and Phase2S will:

1. Embed the current task description using your local Ollama model
2. Score every learning by cosine similarity against that embedding
3. Inject the top matches — the ones most relevant to what you're working on — and skip the 2000-char truncation (since the selection is already filtered)

The index is built on first use and updated incrementally at `.phase2s/search-index.jsonl`. Only changed or new learnings are re-embedded — existing unchanged entries are reused. If you switch `ollamaEmbedModel`, all cached vectors are invalidated and re-embedded once on the next session (the index stores a `model` field per entry to detect staleness).

**Fallback:** if Ollama is unavailable, the embed call fails, or no task text exists yet (e.g., fresh REPL session before your first message), Phase2S falls back to the recency-based 2000-char injection automatically. No configuration needed for the fallback — it's always there.

To use a dedicated, lighter embedding model:

```yaml
# .phase2s.yaml
ollamaBaseUrl: http://localhost:11434/v1
ollamaEmbedModel: nomic-embed-text   # separate embed model from your chat model
```

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
| `.phase2s/sessions/<uuid>.json` | Full conversation history (tool calls included, v2 format) | After every turn |
| `.phase2s/sessions/<uuid>.compact-backup-N.json` | Pre-compaction conversation backup (N = compaction count) | Before each `:compact` or auto-compact operation |
| `.phase2s/sessions/index.json` | O(1) session index (id, parentId, branchName, createdAt per entry) | Updated on every `saveSession`/`cloneSession`; rebuilt automatically if missing or corrupt |
| `.phase2s/state.json` | Active session UUID pointer | On each session start |
| `.phase2s/memory/learnings.jsonl` | Persistent learnings from `/remember` | When you run `/remember` |
| `.phase2s/search-index.jsonl` | Vector index for semantic learnings retrieval (SHA-256 + embedding per entry) | On first session with Ollama configured; updated incrementally on changes |
| `.phase2s/code-index.jsonl` | Semantic code index for `:search` / `phase2s search` (SHA-256 + embedding per file) | After `phase2s sync` |
| `.phase2s/skills/<name>/SKILL.md` | Custom skills from `/skill` | When you run `/skill` |
| `.phase2s/context/<ts>-<slug>.md` | Satori context snapshot (git branch, commits, diff, task) | Before every `/satori` run |
| `.phase2s/satori/<slug>.json` | Satori attempt log (attempt #, pass/fail, failure lines) | After every `/satori` run |
| `.phase2s/specs/<datetime>-<slug>.md` | Spec from `/deep-specify` or `/tdd` | After `/deep-specify` or `/tdd` completes |
| `.phase2s/debug/<datetime>-<slug>.md` | Debug session log from `/debug` | After `/debug` completes |
| `.phase2s/debug/<datetime>-investigate-<slug>.md` | Root cause investigation log from `/investigate` | After `/investigate` completes |
| `.phase2s/review/<datetime>-<branch>.md` | Code review report from `/review` | After `/review` completes |
| `.phase2s/docs/<datetime>-<slug>.md` | Documentation summary from `/docs` | After `/docs` completes |
| `.phase2s/security-reports/<datetime>.md` | Security audit report from `/audit` | After `/audit` completes |
| `.phase2s/checkpoints/<datetime>.md` | Session state snapshot from `/checkpoint` | When you run `/checkpoint` |
| `.phase2s/health/history.jsonl` | Health score history | After every `/health` run |
| `.phase2s/retro/<date>.md` | Retro report | After every `/retro` run |

**All session files use `mode: 0o600` (owner-read/write only).** This applies to conversation history. Other files (specs, checkpoints, debug logs) use standard file permissions since they're meant to be shared with your team.

**.phase2s/ belongs in your repo.** Commit skills, memory, and specs. Keep sessions in `.gitignore` if you don't want conversation history in version control.
