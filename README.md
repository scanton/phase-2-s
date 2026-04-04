# Phase2S

A CLI AI programming harness with streaming output and a skill system. Phase2S runs an agent loop against OpenAI — responses stream to your terminal word-by-word as the model thinks. Type `/review`, `/investigate`, `/plan`, and watch the output appear live.

```
you > explain how the agent loop works
assistant > The agent loop in src/core/agent.ts works like this...
```

Install it globally and run it anywhere:

```bash
npm install -g phase2s
OPENAI_API_KEY=sk-... phase2s run "list my TypeScript files"
```

---

## Install

Requires [Node.js](https://nodejs.org) >= 20 and [OpenAI Codex CLI](https://github.com/openai/codex).

```bash
npm install -g phase2s
```

Check it works:

```bash
phase2s --help
```

---

## Quick start

**Interactive REPL** (default):
```bash
phase2s
```

**One-shot mode:**
```bash
phase2s run "explain what src/core/agent.ts does"
```

**List available skills:**
```bash
phase2s skills
```

---

## Built-in skills

Phase2S ships with 6 skills in `.phase2s/skills/`. Type them in the REPL or pass a file argument:

| Skill | What it does |
|-------|-------------|
| `/review` | Code review with critical/warn/nit severity tagging |
| `/investigate` | Root cause debugging — traces evidence chain to the actual line |
| `/plan` | Phased implementation plan with verify steps per phase |
| `/ship` | Commit prep: diff review, secret check, formatted commit message |
| `/qa` | Functional QA: edge cases, empty inputs, error paths, bug report |
| `/explain` | Explains code or a concept clearly — pass `{{target}}` to specify what |

**With file arguments:**
```bash
/review src/core/agent.ts           # focus review on one file
/review src/core/ src/cli/          # focus on multiple paths
/investigate why does the REPL exit # pass a description instead
```

---

## Writing your own skills

Skills are Markdown files with YAML frontmatter. Drop one in `.phase2s/skills/` and it becomes a `/command` immediately — no restart needed.

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
  - phrase that should invoke this skill
  - another phrase
---

Your prompt template goes here. Codex will receive this as its instruction,
with any user-provided arguments appended as "Focus on this file: X" or
"Additional context: Y".

Be specific. Tell Codex exactly what format to respond in.
```

**Skill search order** (first match wins):
1. `.phase2s/skills/` in the current project
2. `~/.phase2s/skills/` for global user skills
3. `~/.codex/skills/` — Codex CLI's native skill directory

Any skill you've already written for Codex CLI works in Phase2S automatically.

---

## Configuration

Copy `.phase2s.yaml.example` to `.phase2s.yaml` and customize:

```yaml
# LLM provider
provider: codex-cli       # wraps Codex CLI (default)
# provider: openai-api   # direct OpenAI API

# Model — auto-detected from ~/.codex/config.toml if not set
# model: gpt-4o

# Max agent loop turns
maxTurns: 50

# Allow destructive shell commands (rm -rf, sudo, curl | sh, etc.)
# allowDestructive: false
```

**Environment variables:**
| Variable | Description |
|----------|-------------|
| `PHASE2S_PROVIDER` | Override provider (`codex-cli` or `openai-api`) |
| `PHASE2S_MODEL` | Override model |
| `PHASE2S_CODEX_PATH` | Path to codex binary if not on PATH |
| `OPENAI_API_KEY` | API key for `openai-api` provider |
| `PHASE2S_ALLOW_DESTRUCTIVE` | Set to `true` to allow destructive shell commands (`rm -rf`, `sudo`, etc.) |

**Model auto-detection:** If you've set a model in `~/.codex/config.toml`, Phase2S picks it up automatically. No need to configure twice.

---

## How it works

Phase2S runs a provider-abstracted agent loop:

```
user input → skill prompt injection → Codex (or direct API) → tool calls → response
```

**Providers:**
- `codex-cli` — spawns `codex exec` in non-interactive mode (`--json --full-auto`). Each call is a fresh Codex process.
- `openai-api` — direct OpenAI API with streaming output, conversation history, and full tool control. Set `PHASE2S_PROVIDER=openai-api` and `OPENAI_API_KEY=sk-...` to use it. Responses stream to your terminal in real time — no spinner, no wait.

**Tools** (available when using `openai-api` provider):
- `file-read` — read file contents with line range support; sandboxed to project directory
- `file-write` — write or create files; sandboxed to project directory; refuses to truncate an existing file to empty
- `shell` — run shell commands with configurable timeout; blocks destructive patterns by default (`rm -rf`, `sudo`, `curl | sh`, `git push --force`); set `allowDestructive: true` in `.phase2s.yaml` to unlock
- `glob` — find files by pattern
- `grep` — search file contents with regex

---

## CLI reference

```
phase2s [options] [command]

Commands:
  chat        Start an interactive REPL session (default)
  run <prompt> Run a single prompt and exit
  skills       List available skills

Options:
  -p, --provider <provider>  LLM provider (codex-cli | openai-api)
  -m, --model <model>        Model to use
  --system <prompt>          Custom system prompt
  -V, --version              Show version
  -h, --help                 Show help
```

**REPL commands:**
```
/help          Show available skills and commands
/quit          Exit
/exit          Exit
/<skill-name>  Invoke a skill (e.g. /review, /plan)
```

---

## Roadmap

- [x] Codex CLI provider (non-interactive, terminal-safe)
- [x] 6 built-in skills: review, investigate, plan, ship, qa, explain
- [x] SKILL.md compatibility with `~/.codex/skills/`
- [x] Smart skill argument parsing (file paths vs. context strings)
- [x] File sandbox: tools reject paths outside the project directory
- [x] Test suite: 111 tests covering all tools, core modules, and agent integration (`npm test`)
- [x] CI: runs `npm test` on every push and PR (GitHub Actions, Node.js 22)
- [x] Direct OpenAI API provider — live-verified with tool calling (Sprint 3)
- [x] Streaming output — responses stream token-by-token, no spinner (Sprint 4)
- [x] npm publish — `npm install -g phase2s` (Sprint 4)
- [ ] Model-per-skill config via SKILL.md frontmatter
- [ ] Real Codex streaming (JSONL stdout parsing)

---

## License

MIT
