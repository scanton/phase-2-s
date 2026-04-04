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
- All 28 built-in skills
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
- **Model-per-skill routing** — use a cheaper model for quick skills and a smarter model for deep review. Configure `fast_model` and `smart_model` in `.phase2s.yaml`. Skills declare which tier they need.
- **Satori persistent execution** — the `/satori` skill runs your task, runs `npm test`, injects failures back into context, and retries until the tests pass. Enforced by infrastructure, not by hoping the model follows instructions.
- **Symlink-safe file sandbox** — Phase2S checks real file paths before any read or write. A symlink inside your project that points outside it gets blocked at the path level.
- **Conversation context management** — Phase2S trims old tool turns automatically when the context fills up.

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
Phase2S v0.10.0
Type your message and press Enter. Type /quit to exit.

you >
```

Type a question or invoke a skill:
```
you > /review src/core/agent.ts
you > why is the REPL sometimes dropping my last message?
you > /diff
you > /satori add rate limiting to the API middleware
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

Phase2S ships with 28 skills. Type any of them in the REPL:

**Persistent execution:**

| Skill | What it does |
|-------|-------------|
| `/satori` | Persistent execution — implements a task, runs `npm test`, injects failures into context, retries up to 3 times until the tests pass. Logs each attempt to `.phase2s/satori/`. |
| `/consensus-plan` | Consensus-driven planning — runs a planner pass, an architect review, and a critic challenge in sequence. Loops up to 3 times until the plan is approved. |
| `/adversarial` | Cross-model adversarial review — structured challenge of any plan or decision. Returns a machine-readable verdict: `APPROVED`, `CHALLENGED`, or `NEEDS_CLARIFICATION`. Designed for AI-to-AI invocation via Claude Code. |

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

**Memory and meta:**

| Skill | What it does |
|-------|-------------|
| `/remember` | Save a project learning to persistent memory. Gets stored in `.phase2s/memory/learnings.jsonl` and injected into every future session automatically. |
| `/skill` | Create a new Phase2S skill from inside Phase2S. Three-question interview generates a SKILL.md file. No manual YAML editing. |

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
/satori add pagination to the API   — persistent execution until tests pass
/consensus-plan add auth middleware — planner + architect + critic review
/adversarial <paste plan here>      — challenge a plan before implementing
/remember                           — save a learning to persistent memory
/skill                              — create a new skill from inside Phase2S
```

---

## Satori: persistent execution

The hardest coding tasks aren't hard to start — they're hard to finish correctly. You write code, you check it looks right, you ship it. Then three tests fail at 2am.

`/satori` changes the loop. It runs your task, then immediately runs `npm test` (or your configured `verifyCommand`). If tests fail, it injects the exact failure output back into the conversation and tries again. It does this up to 3 times. It stops when the tests are green, not when the model thinks it's done.

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

**What gets written to disk:**

- `.phase2s/context/YYYY-MM-DD-HH-MM-<slug>.md` — a context snapshot before the run starts: git branch, recent commits, diff stat, task description, and success criteria. The agent reads this to recover state across attempts.
- `.phase2s/satori/<slug>.json` — a log of every attempt with pass/fail, exit code, and the failure lines that triggered each retry.

**Satori uses your `smart_model`** if configured (the model declared `model: smart` in its frontmatter). For long retry loops on complex tasks, this matters — you want the model that will actually fix the problem, not the cheap one.

**Configure the verify command:**
```yaml
# .phase2s.yaml
verifyCommand: "npm test -- --run"  # vitest one-shot, no watch mode
# verifyCommand: "pytest tests/"
# verifyCommand: "go test ./..."
```

---

## Consensus planning

`/consensus-plan` runs three internal passes before producing a plan:

1. **Planner pass** — what should we build and how? Produces a concrete, ordered implementation plan with dependencies.
2. **Architect pass** — reviews the plan for structural soundness, edge cases, test coverage. Flags concerns and suggestions per step.
3. **Critic pass** — challenges the plan aggressively. What assumptions are wrong? What will break in production? What's deferred that shouldn't be?

If the Critic finds real objections, the loop restarts with the objections as new constraints (up to 3 total iterations). When consensus is reached, the plan is output as:

- **APPROVED** — ready to implement
- **APPROVED WITH CHANGES** — ready with listed modifications
- **REVISE** — unresolved disagreements, needs your input

Use this before starting any non-trivial feature. It catches the plan errors that only show up in implementation.

---

## Model-per-skill routing

Phase2S v0.10.0 adds model tier routing. Configure two tiers in `.phase2s.yaml`:

```yaml
fast_model: gpt-4o-mini   # cheap and fast — for quick operations
smart_model: o3            # deep reasoning — for review, planning, satori
```

Skills declare which tier they need in their SKILL.md frontmatter:
```yaml
model: smart   # use config.smart_model
model: fast    # use config.fast_model
model: gpt-4o  # literal model name (always this, ignores tier config)
```

Built-in skills that use `model: smart`: `/satori`, `/consensus-plan`.
All other built-in skills use the default model.

**Environment variables:**
```bash
export PHASE2S_FAST_MODEL=gpt-4o-mini
export PHASE2S_SMART_MODEL=o3
```

---

## Session persistence

Every conversation is automatically saved to `.phase2s/sessions/YYYY-MM-DD.json`.

Start a debugging session in the morning, go to lunch, come back:
```bash
phase2s --resume
Resuming session from .phase2s/sessions/2026-04-04.json (14 messages)

you >
```

The full conversation is there — everything the model saw, everything it said, every tool result. Hit Ctrl+C mid-session and Phase2S saves before exiting so you don't lose the turn.

---

## Persistent memory

Phase2S remembers your project preferences and decisions across sessions. Memory is explicit — you decide what gets saved. There's no auto-capture noise.

### How it works

1. You tell Phase2S to remember something: `/remember`
2. Phase2S asks what to remember and what type (preference, decision, pattern, constraint, tool)
3. It appends a JSON line to `.phase2s/memory/learnings.jsonl`
4. Next session: Phase2S loads the file at startup and injects the learnings into the system prompt

The agent reads `.phase2s/memory/learnings.jsonl` before your first message. It knows your project's conventions without you re-explaining them.

### What to remember

- **Preferences**: "This project uses vitest not jest"
- **Decisions**: "We chose Zod over Yup because we need TypeScript strict mode compatibility"
- **Patterns**: "Always run `npm run build` before running tests in this repo"
- **Constraints**: "The codex binary is at /opt/homebrew/bin/codex on this machine"
- **Tools**: "Use `fd` not `find` — it respects .gitignore"

### Example

```
you > /remember
assistant > What should I remember? Give me one specific insight.
you > This project uses vitest, not jest. The test command is npm test.
assistant > What type is this? preference, decision, pattern, constraint, or tool?
you > preference
assistant > Saved learning 'test-framework' to .phase2s/memory/learnings.jsonl.
           It will be loaded at the start of every future session.
```

Next session startup:

```
Phase2S v0.12.0
Learnings: 1 entry from .phase2s/memory/
```

### Creating new skills from memory

The `/skill` meta-skill lets you create new Phase2S skills from inside Phase2S. No YAML editing required.

```
you > /skill
assistant > What should this skill do? Describe it in one sentence.
you > Summarize the current git diff in plain English for a non-technical reviewer.
assistant > What phrases should trigger this skill? Give me 3 to 5 examples.
you > summarize changes, explain the diff, PR summary, what changed in plain english, summarize for review
assistant > Does this skill need extra intelligence? default, fast, or smart?
you > smart
assistant > Skill '/diff-summary' created at .phase2s/skills/diff-summary/SKILL.md.
           Run `phase2s skills` to verify it loaded.
```

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
model: fast        # optional: fast | smart | literal model string
retries: 3         # optional: enables satori retry loop (0 = off)
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

**To make your own satori skill** — add `retries: 3` and `model: smart` to the frontmatter. Phase2S will automatically handle the retry loop, context snapshot, and log writing. You just write the prompt for what the agent should implement.

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

# Model tier routing (openai-api provider)
# fast_model: gpt-4o-mini    # used by skills that declare model: fast
# smart_model: o3             # used by skills that declare model: smart

# Max agent loop turns before stopping
maxTurns: 50

# Satori verify command — run after each attempt to check if the task succeeded
# Default: npm test
# verifyCommand: npm test

# Underspecification gate — warn when prompts are too vague (requires force: prefix to bypass)
# requireSpecification: false

# Allow destructive shell commands (rm -rf, sudo, curl | sh, etc.)
# Default: false — these are blocked for safety
# allowDestructive: false
```

**Environment variables:**

| Variable | Description |
|----------|-------------|
| `PHASE2S_PROVIDER` | Override provider (`codex-cli` or `openai-api`) |
| `PHASE2S_MODEL` | Override model |
| `PHASE2S_FAST_MODEL` | Override fast model tier |
| `PHASE2S_SMART_MODEL` | Override smart model tier |
| `PHASE2S_VERIFY_COMMAND` | Override satori verify command |
| `PHASE2S_CODEX_PATH` | Path to codex binary if not on PATH |
| `OPENAI_API_KEY` | API key for `openai-api` provider |
| `PHASE2S_ALLOW_DESTRUCTIVE` | Set to `true` to allow destructive shell commands |

**Model auto-detection:** If you've configured a model in `~/.codex/config.toml`, Phase2S picks it up automatically. No need to configure it twice.

---

## How it works

```
you type a message or /skill
         |
Phase2S injects the skill prompt (if any)
         |
underspecification check (if requireSpecification: true)
         |
model-per-skill routing resolves fast/smart tier
         |
Codex CLI or OpenAI API (your choice)
         |
tool calls run (file reads, shell commands, search)
         |
response streams to your terminal
         |
-- satori mode only --
npm test (or verifyCommand) runs
  tests pass? done
  tests fail? inject failures, retry (up to maxRetries)
         |
-- end satori --
context snapshot + satori log written to .phase2s/
         |
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

## What Phase2S writes to disk

| Path | What's there | When |
|------|-------------|------|
| `.phase2s/sessions/YYYY-MM-DD.json` | Full conversation history | After every turn |
| `.phase2s/context/<ts>-<slug>.md` | Task context snapshot: branch, commits, diff, success criteria | Before every satori run |
| `.phase2s/satori/<slug>.json` | Attempt log: attempt number, pass/fail, failure lines, final status | After every satori run |
| `.phase2s/specs/<date>-<slug>.md` | Structured spec from `/deep-specify` | After /deep-specify completes |
| `.phase2s/debug/<slug>.md` | Debug session log | After /debug completes |
| `.phase2s/checkpoints/<ts>.md` | Session state snapshot | After /checkpoint runs |

---

## CLI reference

```
phase2s [options] [command]

Commands:
  chat              Start an interactive REPL session (default)
  run <prompt>      Run a single prompt and exit
  skills            List available skills
  mcp               Start Phase2S as an MCP server for Claude Code integration

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
/<skill-name>  Invoke a skill (e.g. /review, /diff, /satori, /consensus-plan)
```

---

## Roadmap

- [x] Codex CLI provider (uses ChatGPT subscription, no API key required)
- [x] 26 built-in skills across 6 categories
- [x] SKILL.md compatibility with `~/.codex/skills/`
- [x] Smart skill argument parsing (file paths vs. context strings)
- [x] File sandbox: tools reject paths outside the project directory, including symlink escapes
- [x] 205 tests covering all tools, core modules, and agent integration (`npm test`)
- [x] CI: runs `npm test` on every push and PR (GitHub Actions, Node.js 22)
- [x] Direct OpenAI API provider with live tool calling
- [x] Streaming output — responses stream token-by-token, no spinner
- [x] `npm install -g phase2s`
- [x] Session persistence — auto-save after each turn, `--resume` to continue
- [x] Model-per-skill routing — `fast_model` / `smart_model` tiers in `.phase2s.yaml`
- [x] Satori persistent execution — retry loop with shell verification, context snapshots, attempt logs
- [x] Consensus planning — planner + architect + critic passes
- [x] Claude Code MCP integration — all skills available as Claude Code tools via `phase2s mcp`
- [x] `/adversarial` skill — cross-model adversarial review with structured output
- [x] Persistent memory — `/remember` saves learnings to `.phase2s/memory/learnings.jsonl`, injected on every startup
- [x] `/skill` meta-skill — create new skills from inside Phase2S
- [x] Session file security — session files written with `mode: 0o600` (owner-only)
- [ ] Real Codex streaming (JSONL stdout parsing)
- [ ] npm publish

---

## Using Phase2S from Claude Code

Phase2S can run as an MCP (Model Context Protocol) server, exposing every skill as a
tool that Claude Code can invoke automatically. This is separate from the normal Phase2S
workflow — you don't type skills in a Phase2S REPL, Claude Code calls them on your behalf
in the background.

The main use case: **cross-model adversarial review**. When Claude Code (running on Claude,
Anthropic's model) is about to execute a plan, it can call `phase2s__adversarial` to get
a structured challenge from Phase2S (running on GPT-4o via your ChatGPT subscription).
Two different models, different training, different biases — working in concert on the
same plan. You get a second opinion from a model with no stake in agreeing with the first.

### What you need

- `phase2s` installed and available in your PATH (`npm install -g phase2s`)
- Claude Code with a project that has a `.claude/settings.json`
- **No API key required** — Phase2S uses your ChatGPT subscription via Codex CLI by default

### Setup

**Step 1: Install Phase2S globally**

```bash
npm install -g phase2s
```

Verify it's in PATH:

```bash
phase2s --version
```

**Step 2: Install and authenticate Codex CLI** (if you haven't already)

```bash
npm install -g @openai/codex
codex auth   # log in with your ChatGPT account
```

**Step 3: Add `.claude/settings.json` to your project root**

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

That's it. Claude Code reads this file when you open the project and automatically starts
`phase2s mcp` as a subprocess in the background. You don't need to run Phase2S manually
in a separate terminal — Claude Code manages the subprocess lifecycle.

**Important: working directory.** Claude Code spawns `phase2s mcp` from your project's
root directory. This means Phase2S loads skills from `.phase2s/skills/` in that project,
and file tools read and write relative to that same root. Everything works from the same
directory Claude Code is already working in. No separate terminal session is needed.

### How Claude Code uses Phase2S skills

Once configured, Claude Code gains a tool for every Phase2S skill. The tools are named
`phase2s__<skill_name>`, with hyphens converted to underscores:

| Phase2S skill | Claude Code tool |
|--------------|-----------------|
| `/adversarial` | `phase2s__adversarial` |
| `/plan-review` | `phase2s__plan_review` |
| `/consensus-plan` | `phase2s__consensus_plan` |
| `/scope-review` | `phase2s__scope_review` |
| `/health` | `phase2s__health` |
| `/retro` | `phase2s__retro` |
| (all 28 skills) | `phase2s__<name>` |

Adding a new SKILL.md to `.phase2s/skills/` automatically makes it available as a new
Claude Code tool the next time the MCP server starts. No code changes required.

### The `/adversarial` skill

`/adversarial` is specifically designed for AI-to-AI invocation. Unlike most Phase2S
skills (which are meant for humans to invoke interactively), it has no questions, no
interactive steps, and produces machine-readable structured output:

```
VERDICT: CHALLENGED | APPROVED | NEEDS_CLARIFICATION
STRONGEST_CONCERN: [one sentence, specific and citable]
OBJECTIONS:
1. [specific, falsifiable objection]
2. [specific, falsifiable objection]
3. [optional]
APPROVE_IF: [what would need to change]
```

Claude Code can parse this output and act on it — for example, refusing to proceed with
implementation if the verdict is `CHALLENGED`, or raising the objections with you before
continuing.

You can also invoke `/adversarial` manually from your Phase2S REPL:

```
you > /adversarial
[paste the plan you want challenged]
```

### Routing rules

The `CLAUDE.md` file at the project root tells Claude Code when to reach for Phase2S tools
automatically. The repo includes a `CLAUDE.md` with routing rules that trigger adversarial
review before significant plan execution. You can customize these rules to match your workflow.

---

## License

MIT
