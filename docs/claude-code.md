# Using Phase2S with Claude Code

Phase2S can run as an MCP (Model Context Protocol) server, exposing every skill as a tool that Claude Code can invoke automatically. This is separate from the normal Phase2S REPL workflow — you don't type skills yourself, Claude Code calls them on your behalf in the background.

---

## What this enables

The main use case is **cross-model adversarial review**. When Claude Code (running on Claude, Anthropic's model) is about to execute a plan, it can call `phase2s__adversarial` to get a structured challenge from Phase2S (running on GPT-4o via your ChatGPT subscription).

Two different models, different training, different biases, working in concert on the same plan. You get a second opinion from a model with no stake in agreeing with the first.

All other Phase2S skills are available too: `phase2s__health`, `phase2s__plan_review`, `phase2s__consensus_plan`, all 29.

---

## What you need

- `phase2s` installed globally: `npm install -g @scanton/phase2s`
- Codex CLI installed and authenticated: `npm install -g @openai/codex && codex auth`
- Claude Code with a project open
- **No API key required.** Phase2S uses your ChatGPT subscription by default.

---

## Setup

**Step 1: Verify phase2s is in PATH**

```bash
phase2s --version
```

If this doesn't work, `npm install -g @scanton/phase2s` and try again.

**Step 2: Add `.claude/settings.json` to your project root**

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

That's it. Claude Code reads this file when you open the project and automatically starts `phase2s mcp` as a subprocess. You don't need to run Phase2S manually in a separate terminal.

**Working directory:** Claude Code spawns `phase2s mcp` from your project's root directory. Phase2S loads skills from `.phase2s/skills/` in that project, and file tools read and write relative to that root. Everything works from the same directory Claude Code is already working in.

---

## How Claude Code uses Phase2S skills

Once configured, Claude Code gains a tool for every Phase2S skill:

| Phase2S skill | Claude Code tool |
|--------------|-----------------|
| `/adversarial` | `phase2s__adversarial` |
| `/plan-review` | `phase2s__plan_review` |
| `/consensus-plan` | `phase2s__consensus_plan` |
| `/scope-review` | `phase2s__scope_review` |
| `/health` | `phase2s__health` |
| `/retro` | `phase2s__retro` |
| (all 29 skills) | `phase2s__<name>` |

Hyphens in skill names become underscores in tool names. `plan-review` → `phase2s__plan_review`.

**Adding new skills:** Add a SKILL.md to `.phase2s/skills/` and it automatically becomes a new Claude Code tool the next time the MCP server starts. No code changes required.

---

## Routing rules

Claude Code needs to know when to reach for Phase2S tools. The `CLAUDE.md` file in your project root tells it. The Phase2S repo includes a `CLAUDE.md` with routing rules:

- Run `phase2s__adversarial` before executing any significant plan
- Run `phase2s__plan_review` when reviewing an engineering spec
- Run `phase2s__health` after completing a sprint
- Run `phase2s__consensus_plan` before starting a non-trivial feature

You can customize `CLAUDE.md` to match your workflow. The rules are just instructions to Claude Code — add, remove, or change them as you see fit.

---

## The `/adversarial` skill in detail

`/adversarial` is specifically designed for AI-to-AI invocation. Unlike most Phase2S skills (which are interactive), it has no questions, no interactive steps, and produces machine-readable structured output:

```
VERDICT: CHALLENGED | APPROVED | NEEDS_CLARIFICATION
STRONGEST_CONCERN: [one sentence, specific and citable]
OBJECTIONS:
1. [specific, falsifiable objection]
2. [specific, falsifiable objection]
3. [optional]
APPROVE_IF: [what would need to change]
```

**APPROVED** — the plan is sound, no blocking objections.

**CHALLENGED** — there are specific, actionable objections. `APPROVE_IF` tells you exactly what needs to change. Claude Code can refuse to proceed and surface the objections to you.

**NEEDS_CLARIFICATION** — the plan is ambiguous in ways that affect whether it's correct. More information needed before a verdict.

All objections are specific and falsifiable. Not "this could be better" — "the bucket isn't cleared between requests in the same window, which means the limit resets on every request instead of every minute."

**Invoking manually:**

```
you > /adversarial
[paste the plan you want challenged]
```

---

## MCP server notes

**Each tool call is stateless.** `tools/call` creates a fresh agent for each invocation. Multi-turn conversations don't persist across MCP calls. If you need conversation continuity, use the Phase2S REPL directly.

**Skills added mid-session aren't visible until restart.** If you create a skill via `/skill` in a Phase2S REPL session while Claude Code's MCP server is running, the new skill won't appear as a tool until Claude Code restarts the `phase2s mcp` subprocess.

**Errors surface as tool errors.** If `phase2s mcp` fails (e.g., codex not authenticated), Claude Code will see a tool error and report it. Run `codex auth` and try again.
