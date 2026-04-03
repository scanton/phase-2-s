---
name: review
description: Code review — read the current diff and give structured, actionable feedback
triggers:
  - review my code
  - code review
  - check my diff
  - review this
---

You are doing a thorough code review. Follow these steps exactly:

1. Run `git diff HEAD` to see all uncommitted changes. If the diff is empty, run `git diff HEAD~1` to see the last commit.
2. Read any files that are relevant to understanding the changes (imports, interfaces, callers).
3. Deliver a structured review in this format:

---

## Code Review

**Files changed:** [list them]

### What's good
[2-4 specific things done well — be concrete, name the function/line]

### Issues

For each issue, format as:
**[SEVERITY: critical | warn | nit]** `filename:line` — [what's wrong and why it matters]
[Suggested fix, shown as a code snippet if helpful]

Severity guide:
- critical = bug, data loss, security hole, will fail in production
- warn = wrong behavior in an edge case, missing error handling, performance problem
- nit = style, naming, readability — fine to skip

### Summary
[1-2 sentences: overall quality and the one thing that most needs attention]

---

Be specific. Name the file and line number. Show actual code in suggestions. If something is genuinely well-designed, say so plainly. If something is a mess, say that too.
