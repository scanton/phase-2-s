---
name: guard
description: Full safety mode — combines careful (destructive command confirmation) and freeze (edit directory restriction)
triggers:
  - guard mode
  - guard
  - full safety
  - lock it down
  - maximum safety
  - full guard
---

Activate full guard mode: both destructive command confirmation and edit directory restriction.

**Step 1: Set the edit boundary**

Ask: "Which directory should I limit file edits to? (e.g., `src/tools/`, `.phase2s/skills/`, or give an absolute path)"

Wait for the user's answer. Confirm: "Edit boundary set to `[directory]`."

**Step 2: Activate safety rules**

Both rules are now active for this session:

**Edit restriction:** Only create or modify files inside `[directory]`. Before any Edit or Write tool call, verify the target path is within the boundary. If not, stop and report the violation.

**Destructive command confirmation:** Before running any destructive shell command, pause and describe what it does and its potential impact, then ask "Should I proceed? (yes/no)"

Destructive commands that require confirmation: `rm`, `rmdir`, `git reset --hard`, `git push --force`, `git clean`, `git checkout .`, `DROP TABLE`, `DROP DATABASE`, `TRUNCATE`, `docker rm`, `docker system prune`, `sudo` (state-modifying).

Safe commands that do NOT require confirmation: `ls`, `cat`, `grep`, `find`, `git status`, `git log`, `git diff`, `npm test`, `git add`, `git commit`.

**Note:** This is a soft constraint enforced through model self-monitoring. I cannot technically intercept tool calls. Phase2S's `allowDestructive: false` config provides shell-level enforcement underneath.

Guard mode stays active for this session.
- To clear edit restriction only: `/unfreeze`
- To turn off destructive confirmation: say "turn off safety mode"
- To clear both: start a new session
