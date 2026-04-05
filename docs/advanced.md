# Advanced Features

> **Streaming and tool-loop visibility require a direct API provider: `openai-api`, `anthropic`, or `ollama`.**
>
> If you're using a ChatGPT subscription (Option A / Codex CLI), you don't need this page. All 29 skills work without it. Come back when you want streaming output or model-per-skill routing.

---

## Enabling a direct API provider

**Option B: OpenAI API**

```bash
export OPENAI_API_KEY=sk-your-key-here
export PHASE2S_PROVIDER=openai-api
phase2s
```

You'll be billed per-token on your OpenAI account.

**Option C: Anthropic API**

```bash
export ANTHROPIC_API_KEY=sk-ant-your-key-here
export PHASE2S_PROVIDER=anthropic
phase2s
```

Defaults to `claude-3-5-sonnet-20241022`. Set `model` in `.phase2s.yaml` to use a different model.

**Option D: Ollama (local)**

```bash
ollama pull llama3.1:8b
export PHASE2S_PROVIDER=ollama
phase2s
```

Ollama uses the same OpenAI-compatible API — the full tool loop works. `ollama serve` must be running.

---

## Token-by-token streaming

With Option B, responses stream word-by-word as the model generates them. No spinner, no waiting for a complete response.

```
you > /review src/core/agent.ts

  CRIT: The `maxTurns` check runs after tool execution, not before.
        An LLM that loops tool calls can exceed the limit by one turn.

  WARN: `getConversation()` returns...
```

The text appears in real time. On long responses (like `/consensus-plan` or `/satori` attempts), you see progress as it happens.

With Option A (Codex CLI), Phase2S shows the response after Codex finishes processing. The output is the same — it's a display difference, not a capability difference.

---

## Phase2S-managed tool loop

With Option B, Phase2S controls the full agent loop:

1. Sends your message and skill prompt to OpenAI API
2. Receives a response that may include tool calls (file reads, shell commands, etc.)
3. Executes each tool call and shows it in your terminal
4. Feeds results back to the model
5. Loops until the model produces a final response with no more tool calls

You see each tool call as it happens:

```
you > /review src/core/agent.ts

[tool: file_read src/core/agent.ts (lines 1-150)]
[tool: file_read src/core/agent.ts (lines 151-300)]

  CRIT: ...
```

With Option A (Codex CLI), Codex handles its own tool loop internally. You see the final response but not the individual tool calls. Both approaches produce the same quality output.

### Tools available (Option B)

| Tool | What it does |
|------|-------------|
| `file_read` | Read file contents with optional line range. Sandboxed to project directory. |
| `file_write` | Write or create files. Refuses to truncate an existing file to empty. Sandboxed. |
| `shell` | Run shell commands. Blocks destructive patterns by default (`rm -rf`, `sudo`, `git push --force`). |
| `glob` | Find files by pattern (`**/*.ts`, `src/**/*.test.*`). |
| `grep` | Search file contents with regex. |

The file sandbox rejects reads and writes outside your project directory, including symlinks that resolve to paths outside it. `realpath()` is called before every sandbox check, so a symlink at `./link -> /etc` gets caught.

---

## Model-per-skill routing

With Option B, you can configure two model tiers and route skills to each one.

**Configure in `.phase2s.yaml`:**

```yaml
fast_model: gpt-4o-mini   # cheap and fast — quick operations
smart_model: o3            # deep reasoning — review, planning, satori
```

**Or via environment variables:**

```bash
export PHASE2S_FAST_MODEL=gpt-4o-mini
export PHASE2S_SMART_MODEL=o3
```

**Skills declare their tier in SKILL.md frontmatter:**

```yaml
model: smart   # resolves to config.smart_model
model: fast    # resolves to config.fast_model
model: gpt-4o  # literal — always uses this model, ignores tier config
```

**Built-in skill tiers (28 of 29 skills declare a tier):**

- **`fast`** (9 skills): `/explain`, `/diff`, `/checkpoint`, `/remember`, `/careful`, `/freeze`, `/guard`, `/unfreeze`, `/skill`
- **`smart`** (19 skills): `/satori`, `/consensus-plan`, `/adversarial`, `/debug`, `/investigate`, `/review`, `/audit`, `/health`, `/qa`, `/tdd`, `/slop-clean`, `/plan`, `/plan-review`, `/scope-review`, `/deep-specify`, `/ship`, `/retro`, `/land-and-deploy`, `/docs`
- **default model** (1 skill): `/autoplan`

**What this means in practice:**

- You type `/explain src/auth.ts` — uses `fast_model`. Fast response, low cost.
- You type `/satori implement pagination` — uses `smart_model`. Slower, costs more, but the retry loop needs the model that will actually fix the problem.
- You type `/review src/core/agent.ts` — uses `smart_model`. Review needs reasoning depth, not speed.

Without `fast_model` / `smart_model` configured, all skills use the same model. Tier routing is optional.

**Note on Satori with Option A:** `/satori` works with Codex CLI (Option A). The retry loop, context snapshots, and attempt logs all work. You just don't get model tier routing — satori uses whatever model Codex is configured to use in `~/.codex/config.toml`.

---

## Conversation context management

With Option B, Phase2S manages context automatically. When the conversation history grows large enough to approach the model's context limit, Phase2S trims old turns.

Trimming preserves atomic units. If a turn includes both an assistant message with tool calls and the corresponding tool results, they're trimmed together. Leaving an assistant message that references tool results without the results would cause an API error.

The system prompt and current turn are never trimmed.

You generally don't need to think about this. It happens automatically. If you're debugging a very long satori run and notice the model seems to have "forgotten" earlier context, it may have been trimmed to fit.

---

## File sandbox technical details

Phase2S uses two layers of file sandboxing:

**Layer 1: Path resolution.** Before any read or write, Phase2S calls `realpath()` on the target path. This resolves symlinks to their real destinations. A symlink at `<project>/link -> /etc/passwd` resolves to `/etc/passwd`, which is then rejected by the sandbox check.

**ENOENT handling:** For new files that don't exist yet (valid for writes), `realpath()` returns ENOENT. Phase2S falls back to `path.resolve()` (lexical resolution) in this case. The file's intended parent directory must still be inside the project.

**Layer 2: Prefix check.** After resolution, the absolute path must start with the project directory prefix. Anything else is rejected with an error returned to the model — not the actual file, not the real path.

Error messages are sanitized before being returned. The model sees "Access denied: path outside project directory", not the actual filesystem path.
