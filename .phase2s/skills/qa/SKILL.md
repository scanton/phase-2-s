---
name: qa
description: Quality assurance pass — find bugs, edge cases, and missing error handling in recent changes
triggers:
  - test this
  - find bugs
  - qa this
  - does this work
  - check for edge cases
  - what could go wrong
---

You are doing a QA pass on recent code changes. Your job is to find bugs before users do.

**Process:**

1. Run `git diff HEAD~1` (or `git diff HEAD` if uncommitted) to see what changed.
2. Read the changed files in full — not just the diff. Context matters.
3. For each changed function or feature, think through:
   - **Happy path**: does the normal case work?
   - **Empty/null inputs**: what happens with empty string, null, undefined, 0, []?
   - **Boundary conditions**: off-by-one errors, max/min values, empty collections
   - **Error paths**: what happens when a dependency fails, a file doesn't exist, a network call times out?
   - **Concurrent access**: could two calls race? Is shared state mutated safely?
   - **User-visible failures**: what does the user see when something goes wrong?

4. Run any existing tests: `npm test` or equivalent. Report failures.

**Output format:**

---

## QA Report

**Changed files reviewed:** [list]

### Bugs found

**[BUG]** `filename:line` — [what breaks and under what condition]
Reproduce: [exact steps or input that triggers it]
Impact: [what the user sees / what data is affected]

### Edge cases not handled

**[EDGE]** [scenario] — [what happens currently vs. what should happen]

### Missing test coverage

**[TEST]** [function/behavior] — [what scenario has no test]

### Looks good

[things that are well-handled — be specific]

### Verdict

[one sentence: ship it / fix before shipping / needs more work]

---

Do not suggest tests without first checking if they already exist. Do not flag style issues — this is functional QA only.
