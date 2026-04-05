# Phase2S

Phase2S is a personal AI coding assistant you run in your terminal. You type questions about your code, ask it to review files, debug problems, or implement a feature — and it answers using your ChatGPT subscription, OpenAI API key, Anthropic API key, or a local Ollama model.

Think of it as a slash-command layer on top of AI. Instead of typing "please review this file for security issues and flag each problem with a severity level", you type `/review src/core/auth.ts` and get a structured, consistent answer every time.

```
you > /review src/core/agent.ts
assistant > Reviewing src/core/agent.ts...

  CRIT: The `maxTurns` check runs after tool execution, not before.
        An LLM that loops tool calls can exceed the limit by one turn.

  WARN: `getConversation()` returns the live object, not a copy.
        Callers that mutate it will corrupt the conversation state.

  NIT:  Inline comment on line 47 is stale — describes old batch behavior.
```

---

## Quick install

Requires [Node.js](https://nodejs.org) >= 20.

**Option A: ChatGPT Plus or Pro subscription (recommended)**

No API key, no per-token billing. All 29 skills work.

```bash
npm install -g @openai/codex @scanton/phase2s
codex auth
phase2s
```

**Option B: OpenAI API key**

Unlocks token-by-token streaming and model-per-skill routing.

```bash
npm install -g @scanton/phase2s
export OPENAI_API_KEY=sk-your-key-here
export PHASE2S_PROVIDER=openai-api
phase2s
```

**Option C: Anthropic API key**

Run all 29 skills on Claude 3.5 Sonnet (or any Anthropic model).

```bash
npm install -g @scanton/phase2s
export ANTHROPIC_API_KEY=sk-ant-your-key-here
export PHASE2S_PROVIDER=anthropic
phase2s
```

**Option D: Local Ollama (free, private, offline)**

No API keys. Runs entirely on your machine after the initial model pull.

```bash
npm install -g @scanton/phase2s
ollama pull llama3.1:8b
export PHASE2S_PROVIDER=ollama
phase2s
```

---

## Quick start

Once you're at the `you >` prompt:

```
you > /review src/core/agent.ts      — code review with CRIT/WARN/NIT tagging
you > /diff                          — review all uncommitted changes
you > /satori add rate limiting      — implement + test + retry until green
you > /health                        — code quality score (tests, types, lint)
you > /remember                      — save a project convention to memory
```

One-shot mode (no REPL):

```bash
phase2s run "/explain src/core/agent.ts"   # routes through the explain skill
phase2s run --dry-run "/satori add auth"   # preview which skill + model, no execution
```

Tab completion (bash/zsh):

```bash
eval "$(phase2s completion bash)"          # add to ~/.bashrc for persistent completion
phase2s run "/exp<TAB>"                    # completes to /explain
```

Resume your last session:

```bash
phase2s --resume
```

---

## What's included

29 built-in skills across 6 categories. A few highlights:

- `/satori` — implement a task, run `npm test`, retry on failure (up to 3 times). Stops when tests are green, not when the model thinks it's done.
- `/consensus-plan` — planner + architect + critic passes before producing a plan. Catches the errors that only show up in implementation.
- `/deep-specify` — Socratic interview before writing code. Saves a spec with Intent, Boundaries, and Success criteria.
- `/debug` — reproduce, isolate, fix, and verify a bug end-to-end.
- `/remember` — save project conventions to persistent memory. Injected into every future session automatically.
- `/skill` — create a new `/command` from inside Phase2S. Three questions, no YAML editing.
- `/land-and-deploy` — push, open a PR, merge it, wait for CI, confirm the land. Picks up where `/ship` leaves off.

List everything:

```bash
phase2s skills
```

---

## Docs

- [Getting started](docs/getting-started.md) — full setup walkthrough, first session, first skill call
- [Skills reference](docs/skills.md) — all 29 skills with examples and arguments
- [Workflows](docs/workflows.md) — real development sessions: feature, debug, review, weekly rhythm
- [Memory and persistence](docs/memory.md) — session resume, `/remember`, what Phase2S writes to disk
- [Writing custom skills](docs/writing-skills.md) — SKILL.md format, frontmatter fields, examples
- [Advanced](docs/advanced.md) — streaming, tool loop, model routing (requires API key)
- [Claude Code integration](docs/claude-code.md) — MCP server setup, cross-model adversarial review
- [Configuration](docs/configuration.md) — `.phase2s.yaml` reference, environment variables

---

## Roadmap

- [x] Codex CLI provider (uses ChatGPT subscription, no API key required)
- [x] 29 built-in skills across 6 categories
- [x] SKILL.md compatibility with `~/.codex/skills/`
- [x] Smart skill argument parsing (file paths vs. context strings)
- [x] File sandbox: tools reject paths outside the project directory, including symlink escapes
- [x] 320 tests covering all tools, core modules, and agent integration (`npm test`)
- [x] CI: runs `npm test` on every push and PR (GitHub Actions, Node.js 22)
- [x] Direct OpenAI API provider with live tool calling
- [x] Anthropic API provider — Claude 3.5 Sonnet and family, all 29 skills
- [x] Ollama provider — local models, offline, no API keys required
- [x] Streaming output — responses stream token-by-token
- [x] `npm install -g @scanton/phase2s`
- [x] Session persistence — auto-save after each turn, `--resume` to continue
- [x] Model-per-skill routing — `fast_model` / `smart_model` tiers in `.phase2s.yaml`
- [x] Satori persistent execution — retry loop with shell verification, context snapshots, attempt logs
- [x] Consensus planning — planner + architect + critic passes
- [x] Claude Code MCP integration — all skills available as Claude Code tools via `phase2s mcp`
- [x] `/adversarial` skill — cross-model adversarial review with structured output
- [x] Persistent memory — `/remember` saves learnings to `.phase2s/memory/learnings.jsonl`
- [x] `/skill` meta-skill — create new skills from inside Phase2S
- [x] Session file security — session files written with `mode: 0o600` (owner-only)
- [x] `/land-and-deploy` skill — push, PR, CI wait, merge, deploy confirmation via `gh` CLI
- [x] Model tier badges in `phase2s skills` output — `[fast]` / `[smart]` per skill at a glance
- [x] `phase2s run --dry-run "/explain foo"` — preview skill routing without executing
- [x] Typed input hints in REPL — boolean shows `(yes/no)`, enum shows `[option1/option2]`
- [x] `phase2s skills --json` — machine-readable skill list for scripts and tooling
- [x] Clean install — no deprecation warnings from `npm install -g @scanton/phase2s`
- [x] npm publish — `@scanton/phase2s` on npm, `npm install -g @scanton/phase2s`
- [x] Multi-turn skills — `{{ASK: question?}}` inline prompts in SKILL.md templates
- [x] Shell completion — `eval "$(phase2s completion bash)"` for tab-complete in bash/zsh
- [x] Tool allow/deny — `tools:` and `deny:` in `.phase2s.yaml` restrict agent tool access
- [ ] Real Codex streaming (JSONL stdout parsing)

---

## License

MIT
