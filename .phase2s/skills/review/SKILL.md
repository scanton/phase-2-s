---
name: review
description: Code review — read the current diff and give structured, actionable feedback
model: smart
triggers:
  - review my code
  - code review
  - check my diff
  - review this
inputs:
  scope:
    prompt: "Which files or paths to focus on? (optional — leave blank to review the full diff)"
---

You are doing a thorough code review. Follow these steps exactly:

1. Determine the diff scope:
   - If `{{scope}}` is provided, run `git diff HEAD -- {{scope}}` to see changes in that path.
   - If no scope is given, run `git diff HEAD` to see all uncommitted changes.
   - If the diff is empty, run `git diff HEAD~1` (or `git diff HEAD~1 -- {{scope}}` if scoped) to see the last commit.
2. Read any files that are relevant to understanding the changes (imports, interfaces, callers).
3. Deliver a structured review in this format:

---

## Code Review

**Files changed:** [list them]
**Scope:** [full diff | scoped to: {{scope}}]

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

4. If any critical or warn issues exist, ask the user whether to apply inline fixes before running tests. If the user says yes, apply them now.

5. **Verify:** Run `npm test`. Report the result:
   - If tests pass: "✓ Tests passing — review complete."
   - If tests fail: list the failing tests and whether they were caused by the reviewed changes or were pre-existing.
   Always run this step, regardless of whether inline fixes were applied.

6. **Save:** Use the `shell` tool to get the current datetime (`date +%Y-%m-%d-%H%M`), then save the review output to `.phase2s/review/<datetime>-<branch-slug>.md` where branch-slug is the current git branch name (replace `/` and spaces with `-`). Create the directory first: `mkdir -p .phase2s/review/`. Tell the user the path.

7. After delivering the review, ask:

> Want an adversarial challenge of the design decisions in these changes? This is a separate pass that challenges whether the *approach* is sound — not just code quality, but the assumptions, edge cases, and failure modes baked into the design. Type `yes` to run it or anything else to skip.

8. If the user says yes (or "y", "sure", "go ahead", "do it", or similar):

Run an adversarial review of the diff. Focus on the design decisions, not the syntax. Challenge:
- Whether the approach is the right one for the problem
- Assumptions that could be wrong
- Edge cases the implementation doesn't handle
- Failure modes that aren't obvious from reading the code

Use the adversarial output format exactly:

```
VERDICT: CHALLENGED | APPROVED | NEEDS_CLARIFICATION
STRONGEST_CONCERN: [one sentence, specific and citable]
OBJECTIONS:
1. [specific, falsifiable objection]
2. [specific, falsifiable objection]
3. [optional — only if genuinely distinct]
APPROVE_IF: [what would need to change for APPROVED verdict]
```

If the approach is sound: `VERDICT: APPROVED`, `STRONGEST_CONCERN: None identified.`, `OBJECTIONS: (none)`, `APPROVE_IF: N/A`.

If the user declines, end the session normally.
