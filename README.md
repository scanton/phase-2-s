# Phase2S

An AI programming harness for OpenAI Codex. Phase2S gives Codex a skill system — so instead of typing raw prompts, you run `/review`, `/investigate`, `/plan`, and more. Same idea as gstack for Claude Code, built for Codex.

```
you > /review src/core/agent.ts
Running /review on: src/core/agent.ts...
assistant > ## Code Review
...
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

Phase2S ships with 5 skills in `.phase2s/skills/`. Type them in the REPL or pass a file argument:

| Skill | What it does |
|-------|-------------|
| `/review` | Code review with critical/warn/nit severity tagging |
| `/investigate` | Root cause debugging — traces evidence chain to the actual line |
| `/plan` | Phased implementation plan with verify steps per phase |
| `/ship` | Commit prep: diff review, secret check, formatted commit message |
| `/qa` | Functional QA: edge cases, empty inputs, error paths, bug report |

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
# provider: openai-api   # direct OpenAI API (coming soon)

# Model — auto-detected from ~/.codex/config.toml if not set
# model: gpt-4o

# Max agent loop turns
maxTurns: 50
```

**Environment variables:**
| Variable | Description |
|----------|-------------|
| `PHASE2S_PROVIDER` | Override provider (`codex-cli` or `openai-api`) |
| `PHASE2S_MODEL` | Override model |
| `PHASE2S_CODEX_PATH` | Path to codex binary if not on PATH |
| `OPENAI_API_KEY` | API key for `openai-api` provider |

**Model auto-detection:** If you've set a model in `~/.codex/config.toml`, Phase2S picks it up automatically. No need to configure twice.

---

## How it works

Phase2S runs a provider-abstracted agent loop:

```
user input → skill prompt injection → Codex (or direct API) → tool calls → response
```

**Providers:**
- `codex-cli` — spawns `codex exec` in non-interactive mode (`--json --full-auto`). Each call is a fresh Codex process. Best for one-shot skill invocations.
- `openai-api` — direct API with conversation history and full tool control. Coming in Approach B.

**Tools** (available when using `openai-api` provider):
- `file-read` — read file contents with line range support
- `file-write` — write or create files
- `shell` — run shell commands with timeout
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
- [x] 5 built-in skills: review, investigate, plan, ship, qa
- [x] SKILL.md compatibility with `~/.codex/skills/`
- [x] Smart skill argument parsing (file paths vs. context strings)
- [ ] Direct OpenAI API provider with full tool control
- [ ] Model-per-skill config via SKILL.md frontmatter
- [ ] npm publish

---

## License

MIT
