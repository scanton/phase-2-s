# Configuration

Phase2S configuration lives in `.phase2s.yaml` in your project root. The fastest way to create one:

```bash
phase2s init
```

This runs an interactive wizard: pick your provider, enter your API key (if needed), optionally configure fast/smart model tiers and a Slack webhook. Takes under 60 seconds. Re-run anytime to update settings — existing values are pre-filled.

If you prefer to write the file by hand, copy the example:

```bash
cp .phase2s.yaml.example .phase2s.yaml
```

All settings have sensible defaults. You don't need a config file to use Phase2S.

---

## .phase2s.yaml

Full reference with all fields:

```yaml
# LLM provider
# codex-cli:   uses your ChatGPT subscription via Codex CLI (default, no API key needed)
# openai-api:  direct OpenAI API access (requires OPENAI_API_KEY, per-token billing)
# anthropic:   Anthropic API (requires ANTHROPIC_API_KEY, defaults to claude-3-5-sonnet-20241022)
# ollama:      local Ollama server (no API key, defaults to llama3.1:8b, requires ollama serve)
# openrouter:  OpenRouter gateway (requires OPENROUTER_API_KEY, 50+ models via one key)
# gemini:      Google Gemini (requires GEMINI_API_KEY, free tier available, defaults to gemini-2.0-flash)
# minimax:     MiniMax API (requires MINIMAX_API_KEY, defaults to MiniMax-M2.5)
provider: codex-cli

# Model to use
# If not set: auto-detected from ~/.codex/config.toml (codex-cli provider)
# or defaults to gpt-4o (openai-api), claude-3-5-sonnet-20241022 (anthropic),
# llama3.1:8b (ollama), openai/gpt-4o (openrouter), gemini-2.0-flash (gemini),
# MiniMax-M2.5 (minimax)
# model: gpt-4o
# model: claude-3-5-sonnet-20241022
# model: qwen2.5-coder:7b
# model: openai/gpt-4o          # OpenRouter: use provider-prefixed slugs
# model: anthropic/claude-3-5-sonnet
# model: gemini-2.5-pro         # Gemini: upgrade from the default gemini-2.0-flash

# Model tier routing (openai-api and anthropic providers)
# Skills declare 'model: fast' or 'model: smart' in their SKILL.md frontmatter.
# Phase2S resolves the tier to the model configured here.
# If not set, all skills use the default model above.
# fast_model: gpt-4o-mini
# smart_model: o3

# Anthropic API key (anthropic provider only)
# Falls back to ANTHROPIC_API_KEY environment variable.
# anthropicApiKey: sk-ant-your-key-here

# Anthropic max tokens (anthropic provider only, default 8192)
# Raise for models with higher ceilings (claude-3-opus supports up to 4096 output).
# anthropicMaxTokens: 8192

# Ollama base URL (ollama provider only, default http://localhost:11434/v1)
# Change this if your Ollama server runs on a different host or port.
# Warning: remote URLs will send prompts and tool results to that host.
# ollamaBaseUrl: http://localhost:11434/v1

# OpenRouter API key (openrouter provider only)
# Falls back to OPENROUTER_API_KEY environment variable.
# Get your key at https://openrouter.ai/keys
# openrouterApiKey: sk-or-your-key-here

# OpenRouter base URL (openrouter provider only, default https://openrouter.ai/api/v1)
# Override for custom deployments or compatible gateways.
# openrouterBaseUrl: https://openrouter.ai/api/v1

# Gemini API key (gemini provider only)
# Falls back to GEMINI_API_KEY environment variable.
# Get a free key at https://aistudio.google.com/apikey — keys start with 'AIza'.
# geminiApiKey: AIza-your-key-here

# Gemini base URL (gemini provider only, default https://generativelanguage.googleapis.com/v1beta/openai/)
# Override for custom endpoints or enterprise deployments.
# geminiBaseUrl: https://generativelanguage.googleapis.com/v1beta/openai/

# MiniMax API key (minimax provider only)
# Get a key at https://platform.minimax.io/
# minimaxApiKey: your-key-here

# MiniMax base URL (minimax provider only, default https://api.minimax.io/v1/)
# minimaxBaseUrl: https://api.minimax.io/v1/

# Max agent loop turns before stopping
# The agent loop runs tool calls and feeds results back until no more tool calls.
# This limits runaway loops.
maxTurns: 50

# Satori verify command
# Runs after each attempt to check if the task succeeded.
# Must exit 0 for success, non-zero for failure.
# Default: npm test
# verifyCommand: npm test
# verifyCommand: npm test -- --run      # vitest one-shot, no watch mode
# verifyCommand: pytest tests/
# verifyCommand: go test ./...
# verifyCommand: cargo test

# Underspecification gate
# When true: prompts under 15 words without a file path get a warning.
# Override by prefixing your prompt with "force:" — e.g., "force: go"
# requireSpecification: false

# Allow destructive shell commands
# When false (default): rm -rf, sudo, curl | sh, git push --force are blocked.
# When true: all shell commands are allowed. Use with care.
# allowDestructive: false

# Tool allow-list
# Only the named tools are available to the agent. All others are blocked.
# When omitted, all tools are available.
# Available tools: file_read, file_write, shell, glob, grep
# Supports * as a wildcard: file_* matches file_read and file_write.
# deny takes precedence over tools — a pattern in both lists is always blocked.
# tools:
#   - file_*      # all file tools
#   - glob
#   - grep

# Tool deny-list
# The named tools are blocked even if they appear in tools.
# deny always wins — it is a security control, not a preference.
# Supports * as a wildcard: file_* blocks file_read and file_write.
# Patterns that match no known tool produce a warning at startup.
# deny:
#   - shell

# Notification channels for dark factory runs (phase2s goal --notify)
# mac: true sends a system notification via osascript (macOS only, default: true on macOS)
# slack: Slack incoming webhook URL
# discord: Discord incoming webhook URL
# teams: Microsoft Teams incoming webhook URL
# Each channel also has an env var equivalent (see Environment Variables section below).
# notify:
#   mac: true
#   slack: "https://hooks.slack.com/services/T.../B.../..."
#   discord: "https://discord.com/api/webhooks/.../..."
#   teams: "https://outlook.office.com/webhook/..."
```

---

## Environment variables

All config file settings can be overridden with environment variables. Environment variables take precedence over `.phase2s.yaml`.

| Variable | Equivalent config field | Description |
|----------|------------------------|-------------|
| `PHASE2S_PROVIDER` | `provider` | `codex-cli`, `openai-api`, `anthropic`, `ollama`, `openrouter`, or `gemini` |
| `PHASE2S_MODEL` | `model` | Model name (e.g., `gpt-4o`, `o3`, `claude-3-5-sonnet-20241022`) |
| `PHASE2S_FAST_MODEL` | `fast_model` | Fast tier model name |
| `PHASE2S_SMART_MODEL` | `smart_model` | Smart tier model name |
| `PHASE2S_VERIFY_COMMAND` | `verifyCommand` | Satori verify command |
| `PHASE2S_ALLOW_DESTRUCTIVE` | `allowDestructive` | `true`, `1`, or `yes` to allow |
| `PHASE2S_BROWSER` | `browser` | `true`, `1`, or `yes` to enable Playwright headless browser tool |
| `PHASE2S_SLACK_WEBHOOK` | `notify.slack` | Slack incoming webhook URL for dark factory run notifications |
| `PHASE2S_DISCORD_WEBHOOK` | `notify.discord` | Discord incoming webhook URL for dark factory run notifications |
| `PHASE2S_TEAMS_WEBHOOK` | `notify.teams` | Microsoft Teams incoming webhook URL for dark factory run notifications |
| `PHASE2S_CODEX_PATH` | — | Path to codex binary if not on PATH |
| `OPENAI_API_KEY` | — | API key for `openai-api` provider |
| `ANTHROPIC_API_KEY` | — | API key for `anthropic` provider |
| `OPENROUTER_API_KEY` | `openrouterApiKey` | API key for `openrouter` provider |
| `GEMINI_API_KEY` | `geminiApiKey` | API key for `gemini` provider (keys start with `AIza`) |

---

## Model auto-detection

If you use the `codex-cli` provider and have configured a model in `~/.codex/config.toml`, Phase2S picks it up automatically. You don't need to set `model` in `.phase2s.yaml`.

`~/.codex/config.toml` example:

```toml
model = "gpt-4o"
```

Phase2S reads this at startup. The model in `.phase2s.yaml` (or `PHASE2S_MODEL`) overrides it if set.

---

## Common setups

**Option A: ChatGPT subscription, default settings**

No config file needed. Install, authenticate, run:

```bash
npm install -g @openai/codex @scanton/phase2s
codex auth
phase2s
```

**Option A with custom verify command (vitest)**

```yaml
# .phase2s.yaml
verifyCommand: "npm test -- --run"
```

Vitest's `--run` flag disables watch mode, so satori gets a clean exit after each test run.

**Option B: OpenAI API with model routing**

```yaml
# .phase2s.yaml
provider: openai-api
fast_model: gpt-4o-mini
smart_model: o3
```

```bash
export OPENAI_API_KEY=sk-your-key-here
phase2s
```

Quick skills (like `/explain`, `/diff`) use `gpt-4o-mini`. Deep skills (`/satori`, `/consensus-plan`) use `o3`. The cost difference on a typical workday is significant.

**Option B with Python project**

```yaml
# .phase2s.yaml
provider: openai-api
fast_model: gpt-4o-mini
smart_model: o3
verifyCommand: "pytest tests/ -x"
```

`-x` stops on first failure, so satori gets fast feedback instead of running all tests after a broken implementation.

**Option C: Anthropic API (Claude)**

```yaml
# .phase2s.yaml
provider: anthropic
# model: claude-3-5-sonnet-20241022  # default
# anthropicMaxTokens: 8192           # default
```

```bash
export ANTHROPIC_API_KEY=sk-ant-your-key-here
phase2s
```

All 29 skills work on Claude 3.5 Sonnet. Raise `anthropicMaxTokens` if you hit truncation on long `/satori` runs — Claude 3.5 Sonnet supports up to 8192 output tokens by default.

**Option D: Local Ollama (free, private, offline)**

```yaml
# .phase2s.yaml
provider: ollama
model: qwen2.5-coder:7b   # or llama3.1:8b
```

```bash
ollama pull qwen2.5-coder:7b
phase2s
```

No API keys. Everything runs on your machine after the initial model pull. `qwen2.5-coder:7b` and `llama3.1:8b` both support function calling. `llama3.2` (3B) may drop tool calls on complex prompts.

If your Ollama server is on a different host, set `ollamaBaseUrl`. Note: remote URLs will send prompts and tool results to that host.

---

**Restricted tool access — read-only agent**

Limit the agent to read-only tools. Useful for code review, analysis, and Q&A tasks where you don't want the model writing or executing anything.

```yaml
# .phase2s.yaml
tools:
  - file_read
  - glob
  - grep
```

With this config, `file_write` and `shell` are unavailable. The agent can read and search but not modify files or run commands. Skills that require write access (`/satori`, `/tdd`, `/debug`) will be limited in what they can do.

**Restricted tool access — no shell execution**

Allow file operations but block shell commands. Good for projects where shell access is sensitive (secrets in env, production credentials, etc.):

```yaml
# .phase2s.yaml
deny:
  - shell
```

`deny` overrides `tools` — a name in both lists is always blocked. Unknown tool names in either list produce a warning at startup so typos don't silently expand access.

Available tool names: `file_read`, `file_write`, `shell`, `glob`, `grep`.

---

**Safety mode for shared repos**

```yaml
# .phase2s.yaml
provider: codex-cli
allowDestructive: false
requireSpecification: true
```

`requireSpecification: true` warns when prompts are too short or vague. Helps on projects where you want to be deliberate before making changes.

**Codex binary at a custom path**

If `codex` isn't on your PATH:

```bash
export PHASE2S_CODEX_PATH=/opt/homebrew/bin/codex
```

Or save it with `/remember`:

```
you > /remember
assistant > What should I remember?
you > The codex binary is at /opt/homebrew/bin/codex on this machine.
assistant > Type?
you > constraint
```

This way the path is saved to `.phase2s/memory/learnings.jsonl` and injected into every session. You won't need to set the env var manually.

---

## CLI options

All config options can also be passed on the command line:

```
phase2s [options] [command]

Commands:
  chat                     Start an interactive REPL session (default)
  run <prompt>             Run a single prompt and exit
  goal <spec.md>           Execute a spec autonomously (dark factory)
    --dry-run              Preview the spec decomposition without any LLM calls
    --max-attempts <n>     Number of outer retry attempts (default: 3)
    --review-before-run    Adversarial challenge before execution starts
    --resume               Resume from last completed sub-task
    --notify               Send notification on completion
    --parallel             Enable parallel execution (auto-detected on 3+ independent subtasks)
    --sequential           Force sequential execution (overrides auto-detect)
    --orchestrator         Enable multi-agent orchestrator mode (role-aware, context-passing)
    --workers <n>          Max concurrent workers per level (1-8, default 3)
    --dashboard            Show live tmux dashboard during parallel execution
    --clean                Remove stale worktrees before starting
    --judge                Run spec eval judge after completion; emits eval_judged to run log
  judge <spec.md>          Score a spec's acceptance criteria against a git diff (0-10)
    --diff <file>          Path to a diff file (alternative: pipe diff via stdin)
  skills [query]           List available skills (optional search query)
  lint <spec.md>           Validate a spec file before running it
  report <log.jsonl>       Show a formatted run summary
  init                     Interactive setup wizard
  doctor                   Installation health check
  upgrade                  Check for and install updates
  mcp                      Start as an MCP server for Claude Code

Options:
  -p, --provider <provider>  LLM provider (codex-cli | openai-api | anthropic | ollama | openrouter | gemini)
  -m, --model <model>        Model to use
  --system <prompt>          Custom system prompt
  --resume                   Resume the most recent saved session
  -V, --version              Show version
  -h, --help                 Show help
```

Command-line flags override both `.phase2s.yaml` and environment variables.
