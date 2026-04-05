# Getting Started

Phase2S is an AI coding tool that runs in your terminal on your ChatGPT subscription — no API key required. It also plugs into Claude Code as a second-opinion engine, and can execute entire specs autonomously.

This guide gets you running in under 5 minutes. After you're set up, see:
- [Dark factory guide](dark-factory.md) — write a spec, run `phase2s goal`, get a feature
- [Claude Code integration](claude-code.md) — cross-model adversarial review from inside Claude Code

---

## Prerequisites

- Node.js >= 20. Check: `node --version`
- One of: ChatGPT Plus or Pro subscription, OpenAI API key, Anthropic API key, local Ollama, OpenRouter key, Gemini key, or MiniMax key

---

## Option A: ChatGPT subscription (recommended for most users)

If you pay for ChatGPT at [chat.openai.com](https://chat.openai.com), you already have what you need. No separate API billing. All 29 skills work.

**Step 1: Install Codex CLI and Phase2S**

```bash
npm install -g @openai/codex @scanton/phase2s
```

**Step 2: Run the setup wizard**

```bash
phase2s init
```

This asks you 2-4 questions, checks that your tools are installed correctly, and writes `.phase2s.yaml`. Takes under 60 seconds. Skip it if you prefer setting env vars by hand (Options B-D below still work).

**Step 3: Authenticate Codex CLI with your ChatGPT account**

```bash
codex auth
```

This opens a browser window. Log in with the same account you use at chat.openai.com. Codex saves a token to `~/.codex/`. You only do this once.

**Step 4: Start Phase2S**

```bash
phase2s
```

You'll see:

```
Phase2S v1.10.0
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

## Option C: Anthropic API key (Claude)

Run all 29 skills on Claude 3.5 Sonnet (or any Anthropic model):

```bash
npm install -g @scanton/phase2s
export ANTHROPIC_API_KEY=sk-ant-your-key-here
export PHASE2S_PROVIDER=anthropic
phase2s
```

---

## Option D: Local Ollama (free, private, offline)

No API keys. Runs entirely on your machine after the initial model pull:

```bash
npm install -g @scanton/phase2s
ollama pull llama3.1:8b
export PHASE2S_PROVIDER=ollama
phase2s
```

`ollama serve` must be running. `qwen2.5-coder:7b` is a good alternative if you want stronger tool-calling support on complex tasks.

### Option E — OpenRouter (50+ models, one API key)

```bash
npm install -g @scanton/phase2s
export OPENROUTER_API_KEY=sk-or-your-key-here
export PHASE2S_PROVIDER=openrouter
phase2s
```

Get your key at [openrouter.ai/keys](https://openrouter.ai/keys). Switch models on the fly with `-m anthropic/claude-3-5-sonnet` or set `model:` in `.phase2s.yaml`. All provider-prefixed slugs work: `openai/gpt-4o`, `google/gemini-pro-1.5`, etc.

### Option F — Google Gemini (free tier available)

```bash
npm install -g @scanton/phase2s
export GEMINI_API_KEY=AIza-your-key-here
export PHASE2S_PROVIDER=gemini
phase2s
```

Get a free key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey). Keys start with `AIza`. Default model is `gemini-2.0-flash` — upgrade with `model: gemini-2.5-pro` in `.phase2s.yaml`.

### Option G — MiniMax

```bash
npm install -g @scanton/phase2s
export MINIMAX_API_KEY=your-key-here
export PHASE2S_PROVIDER=minimax
phase2s
```

Get your key at [platform.minimax.io](https://platform.minimax.io/). Default model is `MiniMax-M2.5` — upgrade with `model: MiniMax-M2.7` in `.phase2s.yaml`.

---

## Verify your installation

If something isn't working, run the health check:

```bash
phase2s doctor
```

It checks your Node.js version, provider binary, API key, config file, and working directory — then tells you exactly what to fix.

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

List all available skills, or search by topic:

```bash
phase2s skills               # list everything
phase2s skills quality       # → /health, /qa, /audit
phase2s skills deploy        # → /ship, /land-and-deploy
```

See [docs/skills.md](skills.md) for the full reference.

To keep Phase2S up to date:

```bash
phase2s upgrade
```

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

Run a skill and exit (useful for scripts and CI):

```bash
phase2s run "/explain src/core/agent.ts"
phase2s run "/review src/api/middleware.ts"
```

Phase2S routes `/skillname` syntax through the skill system — same behavior as the REPL. The skill's model tier applies: `fast` uses your `fast_model`, `smart` uses your `smart_model`.

Plain prompts also work if you don't want a specific skill:

```bash
phase2s run "what does src/core/agent.ts do?"
```

To preview routing without executing (useful for debugging `fast_model`/`smart_model` config):

```bash
phase2s run --dry-run "/explain src/core/agent.ts"
# → Would route to skill: explain (model: gpt-4o-mini)
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

**The three main features:**
- [Dark factory](dark-factory.md) — write a spec, run `phase2s goal`, get a feature built autonomously
- [Claude Code integration](claude-code.md) — set up cross-model adversarial review in 2 minutes
- [Skills reference](skills.md) — all 29 built-in skills with examples

**Everything else:**
- [Workflows](workflows.md) — what a real development day with Phase2S looks like
- [Memory and persistence](memory.md) — session resume, `/remember`, `/skill`
- [Writing custom skills](writing-skills.md) — create your own `/commands`
- [Configuration](configuration.md) — `.phase2s.yaml` and environment variables
- [GitHub Action](github-action.md) — run skills in CI (requires API key, not ChatGPT subscription)
