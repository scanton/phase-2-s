---
name: plan-review
description: Engineering plan review — scope validation, architecture critique, test coverage map, performance analysis
triggers:
  - review the architecture
  - engineering review
  - lock in the plan
  - plan review
  - review my plan
  - tech review
  - technical review
  - review this plan
---

Run an engineering plan review in six sections. For each section, raise issues one at a time — don't batch everything into a wall of text.

If the user provides a plan file path, read it first. Otherwise, ask what plan or design to review.

---

## Section 1: Scope Validation

Is this the minimum viable implementation? Challenge:
- What's the simplest thing that could accomplish the stated goal?
- What's being built that could be deferred?
- What's being deferred that should actually be included (hidden dependencies)?
- Are there existing utilities, patterns, or modules in the codebase that do part of this?

Run `find . -name "*.ts" | xargs grep -l "relevant keywords" 2>/dev/null | head -10` to check what already exists.

## Section 2: Architecture

Evaluate the design:
- Data flow: how does input become output? Trace the full path.
- Failure modes: what happens when each external call fails? (network, file system, subprocess)
- State management: where is mutable state? Is it necessary?
- Interface contracts: are the types/schemas precise or is there an `any` escape hatch?

Flag any single point of failure or hard-to-test integration point.

## Section 3: Code Quality

Check for:
- DRY violations — is the same logic duplicated across files?
- Error handling — are errors wrapped with context or just re-thrown bare?
- Technical debt being introduced — anything that will need to be revisited?
- Naming clarity — do function and variable names explain intent?

## Section 4: Test Coverage Map

Draw an ASCII map of codepaths and their test status:

```
[user input] → [parser] → [tool call] → [result]
     ✓             ✓           ✓            ?
                              ↓
                        [error path]
                              ?
```

Mark: ✓ (tested), ? (gap), ✗ (tested wrong / false positive)

Identify the top 3 test gaps that would catch the most real bugs.

## Section 5: Performance

Flag any:
- N+1 patterns (loop that makes repeated calls)
- Synchronous I/O in a hot path
- Unbounded memory growth (accumulating arrays, unclosed streams)
- Missing timeouts on external calls

Give concrete estimates where possible ("this runs per-turn, so at 50 turns that's N calls").

## Section 6: Outside Voice

Generate one adversarial challenge: what would a skeptical engineer say is the biggest flaw in this plan? Be concrete and specific, not generic. Then offer a response to the challenge.

---

**End of review.** Summarize: total issues found, severity breakdown (blocking / should-fix / consider), recommendation (APPROVE / APPROVE WITH CHANGES / REVISE AND RESUBMIT).
