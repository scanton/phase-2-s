---
name: freeze
description: Restrict file edits to a single directory for this session — useful when you want to limit scope of changes
model: fast
triggers:
  - freeze
  - restrict edits
  - only edit this folder
  - lock down edits
  - freeze edits
  - limit edits to
  - only change files in
inputs:
  directory:
    prompt: "Which directory should I limit edits to? (e.g., src/tools/, src/core/, or an absolute path)"
---

Edit freeze active. I will only create or modify files within `{{directory}}` for this session.

**Rules for the rest of this conversation:**

Only use Edit or Write tools on files inside `{{directory}}`.

Before any edit, check: does this file path start with the frozen directory? If yes, proceed. If no, stop and say:
"Edit blocked — `[file]` is outside the frozen directory `{{directory}}`. To edit it, either `/unfreeze` or confirm you want to override the restriction."

**What is NOT restricted:**
- Reading files anywhere (Read, Glob, Grep tools)
- Running shell commands (including commands that modify files via bash — this is a soft constraint on the Edit/Write tools only)
- Viewing git history, running tests, etc.

**Note:** This is a soft constraint. I enforce it through self-monitoring of Edit and Write tool calls. A bash command could still modify files outside the boundary — I will avoid that, but I cannot technically block it.

To clear the restriction: `/unfreeze`
To check current restriction: ask "what's the current freeze directory?"
