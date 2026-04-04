---
name: retro
description: Weekly engineering retrospective — what shipped, velocity stats, patterns, one improvement to focus on next week
model: smart
triggers:
  - retro
  - weekly retro
  - what did we ship
  - engineering retrospective
  - what did I ship this week
  - week in review
---

Run a structured engineering retrospective for the last 7 days.

Start by gathering data:

```bash
git log --oneline --since="7 days ago" --format="%h %ad %s" --date=short
git log --since="7 days ago" --numstat --format="" | awk '{adds+=$1; dels+=$2} END {print adds" additions, "dels" deletions"}'
git log --since="7 days ago" --format="%s" | grep -iE "^fix|^bug" | wc -l
git log --since="7 days ago" --format="%s" | grep -iE "^test|^spec" | wc -l
git log --since="7 days ago" --format="%s" | wc -l
```

Then analyze and report in this format:

## Retro — [date range]

### What Shipped
List each meaningful change with a one-sentence explanation of why it matters. Group by theme (features, fixes, tests, infrastructure). Skip noise commits (merge commits, typo fixes, version bumps).

### Velocity
- Commits: N
- Lines changed: +adds / -dels
- Fix ratio: N% (commits starting with fix/bug)
- Test ratio: N% (commits touching test files)

### Patterns
What do the commit messages tell you about where time was actually spent? Any repeated fixes in the same area (churn)? Any days with no commits (blockers or context switching)?

### One Thing to Improve
Pick the single most actionable improvement for next week based on the patterns. Concrete and specific — not "write more tests" but "add tests for the sandbox edge cases flagged in TODOS.md."

Save the report to `.phase2s/retro/[YYYY-MM-DD].md` after generating it.
