---
name: diff
description: Review uncommitted changes or the last commit with structured feedback
model: fast
triggers:
  - review this diff
  - review my diff
  - what changed
  - check my diff
  - review my changes
  - what did I change
  - show me what changed
---

You are reviewing a git diff. First, run `git status` to understand the current state.

Then run the appropriate diff command:
- For uncommitted changes: `git diff HEAD` (shows both staged and unstaged changes)
- If nothing is staged or unstaged, fall back to: `git diff HEAD~1` (last commit)

For each changed file, provide:
1. **What changed** — concise summary of the actual edits
2. **Why it probably changed** — inferred intent from context
3. **Risk** — what could break, edge cases to watch, correctness concerns
4. **Test gap** — what behavior isn't covered by tests

If there are no changes at all (clean tree, no recent commits), say so clearly.

End with a one-line verdict:
- **LOOKS GOOD** — no significant concerns
- **NEEDS REVIEW** — minor issues worth addressing
- **RISKY** — significant concerns that should be fixed before committing/shipping

Keep the review concrete. Name files and line numbers. Don't restate the diff — explain what it means.
