---
name: review
description: Code review — read the current diff and give structured, actionable feedback
model: smart
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

4. After delivering the review, ask:

> Want an adversarial challenge of the design decisions in these changes? This is a separate pass that challenges whether the *approach* is sound — not just code quality, but the assumptions, edge cases, and failure modes baked into the design. Type `yes` to run it or anything else to skip.

5. If the user says yes (or "y", "sure", "go ahead", "do it", or similar):

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
