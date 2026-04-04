# Getting Started

Phase2S is a personal AI coding assistant you run in your terminal. You type questions, invoke skills with `/skill-name`, and it reads your code, runs your tests, and helps you ship.

This guide gets you running in under 5 minutes.

---

## Prerequisites

- Node.js >= 20. Check: `node --version`
- A ChatGPT Plus or Pro subscription, OR an OpenAI API key

---

## Option A: ChatGPT subscription (recommended for most users)

If you pay for ChatGPT at [chat.openai.com](https://chat.openai.com), you already have what you need. No separate API billing. All 29 skills work.

**Step 1: Install Codex CLI and Phase2S**

```bash
npm install -g @openai/codex @scanton/phase2s
```

**Step 2: Authenticate Codex CLI with your ChatGPT account**

```bash
codex auth
```

This opens a browser window. Log in with the same account you use at chat.openai.com. Codex saves a token to `~/.codex/`. You only do this once.

**Step 3: Start Phase2S**

```bash
phase2s
```

You'll see:

```
Phase2S v0.12.0
Type your message and press Enter. Type /quit to exit.

you >
```

That's it. You're in.

---

## Option B: OpenAI API key

If you have an API key (`sk-...`) from [platform.openai.com](https://platform.openai.com):

```bash
npm install -g @scanton/phase2s
export OPENAI_API_KEY=sk-your-key-here
export PHASE2S_PROVIDER=openai-api
phase2s
```

Option B unlocks token-by-token streaming and model-per-skill routing. See [docs/advanced.md](advanced.md) for what that means and when it matters.

---

## Your first session

Once you're at the `you >` prompt, ask anything about your code:

```
you > what does src/core/agent.ts do?
```

Or invoke a skill directly:

```
you > /review src/core/agent.ts
```

You'll get a structured response with CRIT / WARN / NIT severity tagging.

Try a few more:

```
you > /diff
```

Reviews your uncommitted changes. What changed, what's risky, what's missing from tests.

```
you > /plan add rate limiting to the API
```

A phased implementation plan with verify steps per phase.

```
you > /health
```

Runs your type checker, linter, and tests. Scores code quality 0-10.

---

## Your first skill call

Skills are the core of Phase2S. Type `/` followed by the skill name. Most skills accept an argument — a file path, a directory, or a description in plain English.

```
you > /review src/auth.ts
you > /debug src/api/middleware.ts
you > /satori add pagination to the search endpoint
you > /investigate why does logout sometimes fail silently?
```

List all available skills:

```bash
phase2s skills
```

See [docs/skills.md](skills.md) for the full reference.

---

## Resume a session

Every conversation saves automatically. When you come back:

```bash
phase2s --resume
```

```
Resuming session from .phase2s/sessions/2026-04-04.json (14 messages)

you >
```

Full context restored. Every message, every tool result.

---

## One-shot mode

Run a single prompt and exit (useful for scripts):

```bash
phase2s run "explain what src/core/agent.ts does"
```

---

## What Phase2S saves to your project

Phase2S writes to `.phase2s/` inside your project directory. Nothing goes outside it.

| Path | What's there |
|------|-------------|
| `.phase2s/sessions/YYYY-MM-DD.json` | Conversation history (auto-saved each turn) |
| `.phase2s/memory/learnings.jsonl` | Project learnings you save with `/remember` |
| `.phase2s/skills/` | Custom skills you create with `/skill` |

Everything else (`satori/`, `specs/`, `debug/`, `checkpoints/`) is created on-demand when you run those skills.

---

## Next steps

- [Skills reference](skills.md) — all 29 built-in skills with examples
- [Workflows](workflows.md) — what a real development day with Phase2S looks like
- [Memory and persistence](memory.md) — session resume, `/remember`, `/skill`
- [Writing custom skills](writing-skills.md) — create your own `/commands`
- [Configuration](configuration.md) — `.phase2s.yaml` and environment variables
