# Phase2S project instructions

## After every npm publish

Whenever a new version is published to npm (after pushing a `v*` tag), always tell the user to run this command to update their local install:

```bash
PATH="/opt/homebrew/bin:$PATH" npm install -g @scanton/phase2s
```

Then tell them to verify with:

```bash
PATH="/opt/homebrew/bin:$PATH" phase2s --version
```

## Phase2S adversarial review — always use it, worktree-aware

Before implementing any significant plan, always run an adversarial review. This is a
cross-model sanity check (Claude challenges the plan using GPT via the user's ChatGPT
subscription) and should never be skipped.

**In a worktree session** — MCP tools (`phase2s__adversarial`) may not be registered
because Claude Code starts one MCP server per project window, not per worktree. Use the
CLI directly instead:

```bash
phase2s run "/adversarial <paste plan text here>"
```

This is equivalent to `phase2s__adversarial` and requires no MCP connection.

**If the CLI call fails** (non-zero exit, "command not found", etc.) — stop and surface
the error to the user. A broken `phase2s` install is a bigger problem than the feature
being reviewed; it means the whole review pipeline is dark.

**In a normal project session (not a worktree)** — prefer `phase2s__adversarial` via MCP.
If the tool isn't in the tool list, try reloading the project window first, then fall back
to the CLI.

The rule: we have the tool, we use the tool. Every sprint gets a cross-model review.

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, checkpoint, resume → invoke checkpoint
- Code quality, health check → invoke health
