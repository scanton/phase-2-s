---
name: careful
description: Activate safety mode — pause before destructive shell commands and ask for explicit confirmation
model: fast
triggers:
  - be careful
  - careful
  - safety mode
  - careful mode
  - prod mode
  - be safe
---

Safety mode is now active for this session.

**Rules for the rest of this conversation:**

Before running any shell command that could be destructive or irreversible, pause and describe what the command does and its potential impact. Then ask: "Should I proceed? (yes/no)"

**Commands requiring confirmation:**
- `rm`, `rmdir` — any file or directory removal
- `git reset --hard` — discards uncommitted changes
- `git push --force` or `git push -f` — rewrites remote history
- `git clean` — removes untracked files
- `git checkout .` — discards working directory changes
- `DROP TABLE`, `DROP DATABASE`, `TRUNCATE` — destructive SQL
- `docker rm`, `docker rmi`, `docker system prune` — removes containers/images
- Any command piped to `sh` or `bash` from an external source
- Any `sudo` command that modifies system state

**Commands that do NOT require confirmation:**
- `ls`, `cat`, `head`, `tail`, `find`, `grep` — read-only
- `git status`, `git log`, `git diff`, `git show` — read-only git
- `npm test`, `npm run`, `npx` — build/test commands
- `git add`, `git commit`, `git stash` — safe git operations

Note: Phase2S already blocks destructive commands by default via `allowDestructive: false`. This safety mode adds model-level awareness on top — I will surface the impact of an operation before running it even if the tool would technically allow it.

Safety mode stays active for this session. To deactivate, say "turn off safety mode" or start a new session.
