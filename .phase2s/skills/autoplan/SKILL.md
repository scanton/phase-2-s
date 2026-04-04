---
name: autoplan
description: Auto-review pipeline — runs scope-review then plan-review sequentially, auto-deciding intermediate questions using defined principles
triggers:
  - autoplan
  - auto review
  - run all reviews
  - review this plan automatically
  - full plan review
  - auto plan
  - run the full review
---

Run the full plan review pipeline automatically. Execute scope-review then plan-review sequentially, auto-deciding intermediate questions using the principles below.

Read the plan file if one is provided. Otherwise, read `TODOS.md` and the last 10 commits to reconstruct the current plan context.

---

## Auto-Decision Principles

Use these principles to decide intermediate questions without pausing:

1. **Completeness** — always prefer the more complete option when the cost difference is small (hours, not weeks)
2. **Fix the blast radius** — if something in scope will clearly break related code, fix it in the same pass
3. **Cleaner architecture wins** — when two approaches produce equivalent behavior, pick the more readable one
4. **Eliminate duplication** — reject solutions that duplicate logic already in the codebase
5. **Explicit over clever** — prefer obvious code over smart code that requires a comment to understand
6. **Bias toward action** — when in doubt, implement rather than defer

Classify decisions as:
- **Mechanical** — auto-decide silently using the principles above
- **Taste** — auto-decide, note at the end for user review
- **User Challenge** — never auto-decide (these require the user's judgment: business priorities, external constraints, product direction)

---

## Phase 1: Scope Review

Run the scope review workflow in **Challenge** mode by default. Focus on:
- Is the problem framing right?
- What are the top 3 risks in the stated scope?
- What's being deferred that's actually a hidden dependency?

Auto-decide: which scope items to flag as concerns. Do not ask about mode — use Challenge mode.

---

## Phase 2: Engineering Review

Run the engineering plan review. Auto-decide all section findings using the principles above.

Auto-decide: test gap priorities, performance flag severity, architecture tradeoff choices.

---

## Final Gate

After both phases complete, surface:
1. Any **Taste Decisions** that were auto-decided (let the user confirm or override)
2. Any **User Challenges** that could not be auto-decided (require explicit user input before proceeding)
3. A final summary table of all findings and auto-decisions

Format:
```
## AUTOPLAN DECISIONS

### Auto-decided (Taste)
- [Decision]: chose [X] because [principle]

### Needs your input (User Challenges)
- [Question]: [context] — what do you want to do?

### Verdict
APPROVED / APPROVED WITH CHANGES / REVISE AND RESUBMIT
```

Write this section to the plan file if one exists.
