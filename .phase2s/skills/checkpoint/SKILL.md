---
name: checkpoint
description: Save a structured snapshot of current session state — what we're working on, decisions made, what's left
model: fast
triggers:
  - checkpoint
  - save progress
  - save state
  - where was I
  - what was I working on
  - save my place
  - create a checkpoint
---

Create a structured checkpoint of the current session state. Do not ask the user questions — infer everything from git state and conversation context.

**Gather state:**

```bash
git branch --show-current
git log --oneline -5
git status --short
git diff --stat HEAD 2>/dev/null | tail -5
```

**Write checkpoint to `.phase2s/checkpoints/[YYYY-MM-DD-HH-MM].md`:**

```markdown
# Checkpoint — [timestamp]

## Branch
[current branch]

## What We Were Doing
[1-2 sentences summarizing the active task or problem]

## Recent Changes
[Last 3-5 meaningful commits or uncommitted changes]

## Decisions Made This Session
[Bullet list of any explicit choices made — architecture, approach, scope, etc.
Infer from conversation context. If none are obvious, say "None recorded."]

## Remaining Work
[What's not done yet. Check TODOS.md if it exists. List specific items.]

## Next Step
[The single most important thing to do when resuming. Be concrete.]
```

After saving, confirm: "Checkpoint saved to `.phase2s/checkpoints/[filename]`. Resume with `phase2s --resume` or read this file to pick up where you left off."

Note: `phase2s --resume` loads the conversation history (all messages). This checkpoint file adds a human-readable summary on top of that — useful if the conversation has grown long and you want a quick re-orient.
