# Phase2S

Phase2S is a personal AI coding assistant you run in your terminal. You type questions about your code, ask it to review files, debug problems, or write a commit message — and it answers using your existing AI subscription or API key.

Think of it as adding a slash-command layer on top of AI: instead of typing "please review this file for security issues and flag each problem with a severity level", you type `/review src/core/auth.ts` and get a structured, consistent answer every time.

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

## Do I need a paid subscription or API key?

**Both work. They give you different things.**

### Option A: ChatGPT Plus or Pro subscription (via Codex CLI)

If you pay for ChatGPT at [chat.openai.com](https://chat.openai.com), you already have what you need. The [OpenAI Codex CLI](https://github.com/openai/codex) uses your ChatGPT subscription — no API key, no usage billing on top of what you already pay.

**What works with your ChatGPT subscription:**
- All 18 built-in skills: `/review`, `/investigate`, `/plan`, `/ship`, `/qa`, `/explain`, `/diff`, `/retro`, `/health`, `/audit`, `/plan-review`, `/scope-review`, `/autoplan`, `/checkpoint`, `/careful`, `/freeze`, `/guard`, `/unfreeze`
- One-shot mode: `phase2s run "explain this file"`
- Interactive REPL with skill invocation
- Custom skills you write yourself
- Session auto-save (your conversation saves after every reply)
- `--resume` to continue right where you left off

How it works under the hood: Codex CLI runs its own agent loop that can read your files, run shell commands, and search your codebase. Phase2S adds the skill system, the REPL, and the session persistence on top of that. You get a real coding assistant — you just don't need to manage API billing separately.

**Setup:**
```bash
npm install -g @openai/codex phase2s
codex auth    # log in with your ChatGPT account
phase2s       # start the REPL
```

---

### Option B: OpenAI API key (direct API access)

If you have an OpenAI API key (`sk-...` from [platform.openai.com](https://platform.openai.com)), you get Phase2S's full feature set with Phase2S driving the agent loop directly. You pay per-token usage on top of whatever API plan you're on.

**What you get on top of Option A:**
- **Token-by-token streaming** — responses appear word-by-word as the model thinks, instead of waiting for a complete response
- **Phase2S-managed tool loop** — Phase2S directly controls which tools run (file reads, file writes, shell commands, search). You can see each tool call in your terminal as it happens.
- **Symlink-safe file sandbox** — Phase2S checks real file paths before any read or write. A symlink inside your project that points outside it gets blocked at the path level, not just the name level.
- **Conversation context management** — Phase2S trims old tool turns automatically when the context fills up, keeping long debugging sessions alive without hitting API limits.

**Setup:**
```bash
npm install -g phase2s
export OPENAI_API_KEY=sk-your-key-here
export PHASE2S_PROVIDER=openai-api
phase2s
```

---

## Install

Requires [Node.js](https://nodejs.org) >= 20.

```bash
npm install -g phase2s
```

Verify:
```bash
phase2s --help
```

---

## Quick start

**Interactive REPL (most useful mode):**
```bash
phase2s
```

You'll see a prompt:
```
Phase2S v0.9.0
Type your message and press Enter. Type /quit to exit.

you >
```

Type a question or invoke a skill:
```
you > /review src/core/agent.ts
you > why is the REPL sometimes dropping my last message?
you > /diff
```

**One-shot mode** (run one prompt and exit):
```bash
phase2s run "explain what src/core/agent.ts does"
```

**Resume your last session:**
```bash
phase2s --resume
```
This loads your most recent conversation from `.phase2s/sessions/` and picks up where you left off — full context, all prior messages, every tool result.

**List available skills:**
```bash
phase2s skills
```

---

## Built-in skills

Phase2S ships with 23 skills. Type any of them in the REPL:

**Execution:**

| Skill | What it does |
|-------|-------------|
| `/debug` | Systematic debugging — reproduce, isolate, fix, and verify a bug end-to-end. Saves a log to `.phase2s/debug/`. |
| `/tdd` | Test-driven development — write failing tests first (Red), implement to pass (Green), then refactor. Reports coverage delta. |
| `/slop-clean` | Anti-slop refactor — 5-smell taxonomy (dead code, duplication, needless abstraction, boundary violations, missing tests). One category at a time, tests after each pass. |
| `/deep-specify` | Structured spec interview — Socratic questions resolve ambiguity before any code is written. Outputs Intent / Boundaries / Non-goals / Success criteria to `.phase2s/specs/`. |
| `/docs` | Inline documentation — generates JSDoc/TSDoc, type annotations, and module headers for undocumented code. |

**Code review and analysis:**

| Skill | What it does |
|-------|-------------|
| `/review` | Code review with CRIT / WARN / NIT severity tagging |
| `/investigate` | Root cause debugging — traces evidence to the exact line |
| `/diff` | Reviews your uncommitted changes — what changed, what's risky, what's missing from tests. Ends with LOOKS GOOD / NEEDS REVIEW / RISKY. |
| `/audit` | Security audit — secrets scan, dependency vulns, input validation, file sandbox review |
| `/health` | Code quality dashboard — runs tests, type check, lint; weighted score 0–10; tracks history |
| `/explain` | Explains code or a concept in plain language |

**Planning and shipping:**

| Skill | What it does |
|-------|-------------|
| `/plan` | Phased implementation plan with verify steps per phase |
| `/plan-review` | Engineering plan review — scope validation, architecture critique, test coverage map |
| `/scope-review` | Scope and ambition challenge — Expand / Hold / Reduce / Challenge modes |
| `/autoplan` | Runs scope-review + plan-review sequentially with auto-decision principles |
| `/ship` | Commit prep: diff review, secret scan, formatted commit message |

**Session and workflow:**

| Skill | What it does |
|-------|-------------|
| `/qa` | Functional QA: edge cases, empty inputs, error paths, bug report |
| `/retro` | Weekly retrospective — git commit analysis, velocity stats, one improvement focus |
| `/checkpoint` | Saves a structured snapshot of current session state to `.phase2s/checkpoints/` |

**Safety:**

| Skill | What it does |
|-------|-------------|
| `/careful` | Safety mode — pauses before destructive shell commands and asks for confirmation |
| `/freeze` | Restricts file edits to a single directory for the session |
| `/guard` | Full safety mode — combines `/careful` and `/freeze` |
| `/unfreeze` | Clears the edit directory restriction set by `/freeze` or `/guard` |

**Skills accept file and context arguments:**
```
/debug src/core/agent.ts            — debug a specific file
/tdd src/auth.ts "reject expired tokens" — TDD a specific behavior
/slop-clean src/tools/              — anti-slop pass on one directory
/deep-specify                       — interview before starting work
/docs src/core/agent.ts             — document a specific file
/review src/core/agent.ts           — focus review on one file
/review src/core/ src/cli/          — focus on multiple paths
/investigate why does the REPL exit — describe the problem in words
/diff                               — review all uncommitted changes
/freeze src/tools/                  — restrict edits to the tools directory
/retro                              — last 7 days of commits
```

---

## Session persistence

Every conversation is automatically saved to `.phase2s/sessions/YYYY-MM-DD.json`.

Start a debugging session in the morning, go to lunch, come back:
```bash
phase2s --resume
Resuming session from .phase2s/sessions/2026-04-03.json (14 messages)

you >
```

The full conversation is there — everything the model saw, everything it said, every tool result. Hit Ctrl+C mid-session and Phase2S saves before exiting so you don't lose the turn.

---

## Writing your own skills

Drop a Markdown file in `.phase2s/skills/` and it becomes a `/command` immediately. No restart needed.

```
.phase2s/
  skills/
    my-skill/
      SKILL.md
```

**SKILL.md format:**
```markdown
---
name: my-skill
description: One line describing what this skill does
triggers:
  - phrase that triggers this skill
  - another trigger phrase
---

Your prompt template goes here. Write exactly what you want the model to do,
in the format you want it to respond in. Be specific.

The user's arguments are appended automatically:
- /my-skill src/auth.ts → "Focus on this file: src/auth.ts"
- /my-skill why is login slow → "Additional context: why is login slow"
```

**Skill search order** (first match wins):
1. `.phase2s/skills/` in your current project
2. `~/.phase2s/skills/` for skills you want available everywhere
3. `~/.codex/skills/` — Codex CLI's native skill directory

Anything you've already written for Codex CLI works in Phase2S automatically.

---

## Configuration

Copy `.phase2s.yaml.example` to `.phase2s.yaml` in your project root:

```yaml
# LLM provider — which AI to use
provider: codex-cli       # uses your ChatGPT subscription via Codex CLI (default)
# provider: openai-api   # direct OpenAI API (requires OPENAI_API_KEY)

# Model — auto-detected from ~/.codex/config.toml if not set
# model: gpt-4o

# Max agent loop turns before stopping
maxTurns: 50

# Allow destructive shell commands (rm -rf, sudo, curl | sh, etc.)
# Default: false — these are blocked for safety
# allowDestructive: false
```

**Environment variables:**

| Variable | Description |
|----------|-------------|
| `PHASE2S_PROVIDER` | Override provider (`codex-cli` or `openai-api`) |
| `PHASE2S_MODEL` | Override model |
| `PHASE2S_CODEX_PATH` | Path to codex binary if not on PATH |
| `OPENAI_API_KEY` | API key for `openai-api` provider |
| `PHASE2S_ALLOW_DESTRUCTIVE` | Set to `true` to allow destructive shell commands |

**Model auto-detection:** If you've configured a model in `~/.codex/config.toml`, Phase2S picks it up automatically. No need to configure it twice.

---

## How it works

```
you type a message or /skill
         ↓
Phase2S injects the skill prompt (if any)
         ↓
Codex CLI or OpenAI API (your choice)
         ↓
tool calls run (file reads, shell commands, search)
         ↓
response streams to your terminal
         ↓
conversation auto-saved to .phase2s/sessions/
```

**Providers:**

- `codex-cli` — spawns `codex exec` in non-interactive mode. Your ChatGPT subscription covers it. Codex handles its own tool loop (reads files, runs shell commands). Phase2S adds the skill system, REPL, and session persistence on top.

- `openai-api` — Phase2S calls the OpenAI API directly with streaming enabled. Phase2S manages the full agent loop: sends tool definitions to the model, executes the calls, feeds results back. Set `PHASE2S_PROVIDER=openai-api` and `OPENAI_API_KEY=sk-...` to use it.

**Tools** (when using `openai-api` provider, Phase2S controls these directly):

| Tool | What it does |
|------|-------------|
| `file_read` | Read file contents with optional line ranges. Sandboxed to project directory. |
| `file_write` | Write or create files. Refuses to truncate an existing file to empty. Sandboxed. |
| `shell` | Run shell commands. Blocks destructive patterns by default (`rm -rf`, `sudo`, `git push --force`). |
| `glob` | Find files by pattern (`**/*.ts`, `src/**/*.test.*`). |
| `grep` | Search file contents with regex. |

The file sandbox rejects any read or write outside your project directory — including symlinks that point outside. If a skill tries to read `/etc/hosts`, it gets an error, not the file.

---

## CLI reference

```
phase2s [options] [command]

Commands:
  chat              Start an interactive REPL session (default)
  run <prompt>      Run a single prompt and exit
  skills            List available skills

Options:
  -p, --provider <provider>  LLM provider (codex-cli | openai-api)
  -m, --model <model>        Model to use
  --system <prompt>          Custom system prompt
  --resume                   Resume the most recent saved session
  -V, --version              Show version
  -h, --help                 Show help
```

**REPL commands:**
```
/help          Show available skills and commands
/quit          Exit (session auto-saved)
/exit          Exit (session auto-saved)
/<skill-name>  Invoke a skill (e.g. /review, /diff, /investigate)
```

---

## Roadmap

- [x] Codex CLI provider (uses ChatGPT subscription, no API key required)
- [x] 23 built-in skills: review, investigate, plan, ship, qa, explain, diff, retro, health, audit, plan-review, scope-review, autoplan, checkpoint, careful, freeze, guard, unfreeze, debug, tdd, slop-clean, deep-specify, docs
- [x] SKILL.md compatibility with `~/.codex/skills/`
- [x] Smart skill argument parsing (file paths vs. context strings)
- [x] File sandbox: tools reject paths outside the project directory, including symlink escapes
- [x] 157 tests covering all tools, core modules, and agent integration (`npm test`)
- [x] CI: runs `npm test` on every push and PR (GitHub Actions, Node.js 22)
- [x] Direct OpenAI API provider with live tool calling
- [x] Streaming output — responses stream token-by-token, no spinner
- [x] `npm install -g phase2s`
- [x] Session persistence — auto-save after each turn, `--resume` to continue
- [ ] Model-per-skill config (faster model for quick skills, smarter model for review)
- [ ] Real Codex streaming (JSONL stdout parsing)

---

## License

MIT
