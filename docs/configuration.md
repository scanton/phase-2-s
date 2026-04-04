# Configuration

Phase2S configuration lives in `.phase2s.yaml` in your project root. Copy the example file to get started:

```bash
cp .phase2s.yaml.example .phase2s.yaml
```

All settings have sensible defaults. You don't need a config file to use Phase2S.

---

## .phase2s.yaml

Full reference with all fields:

```yaml
# LLM provider
# codex-cli: uses your ChatGPT subscription via Codex CLI (default, no API key needed)
# openai-api: direct OpenAI API access (requires OPENAI_API_KEY, per-token billing)
provider: codex-cli

# Model to use
# If not set: auto-detected from ~/.codex/config.toml (Codex CLI provider)
# or defaults to gpt-4o (openai-api provider)
# model: gpt-4o

# Model tier routing (openai-api provider only)
# Skills declare 'model: fast' or 'model: smart' in their SKILL.md frontmatter.
# Phase2S resolves the tier to the model configured here.
# If not set, all skills use the default model above.
# fast_model: gpt-4o-mini
# smart_model: o3

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
```

---

## Environment variables

All config file settings can be overridden with environment variables. Environment variables take precedence over `.phase2s.yaml`.

| Variable | Equivalent config field | Description |
|----------|------------------------|-------------|
| `PHASE2S_PROVIDER` | `provider` | `codex-cli` or `openai-api` |
| `PHASE2S_MODEL` | `model` | Model name (e.g., `gpt-4o`, `o3`) |
| `PHASE2S_FAST_MODEL` | `fast_model` | Fast tier model name |
| `PHASE2S_SMART_MODEL` | `smart_model` | Smart tier model name |
| `PHASE2S_VERIFY_COMMAND` | `verifyCommand` | Satori verify command |
| `PHASE2S_ALLOW_DESTRUCTIVE` | `allowDestructive` | `true`, `1`, or `yes` to allow |
| `PHASE2S_CODEX_PATH` | — | Path to codex binary if not on PATH |
| `OPENAI_API_KEY` | — | API key for `openai-api` provider |

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
npm install -g @openai/codex phase2s
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
  chat              Start an interactive REPL session (default)
  run <prompt>      Run a single prompt and exit
  skills            List available skills
  mcp               Start as an MCP server for Claude Code

Options:
  -p, --provider <provider>  LLM provider (codex-cli | openai-api)
  -m, --model <model>        Model to use
  --system <prompt>          Custom system prompt
  --resume                   Resume the most recent saved session
  -V, --version              Show version
  -h, --help                 Show help
```

Command-line flags override both `.phase2s.yaml` and environment variables.
