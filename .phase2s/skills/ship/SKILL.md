---
name: ship
description: Prepare and execute a clean commit — review the diff, run tests, write the message, check nothing's broken
model: smart
triggers:
  - ship this
  - commit this
  - ready to ship
  - push this
  - create a commit
---

You are preparing to ship code. Do not commit blindly — review first.

**Process:**

1. Run `git status` and `git diff HEAD` to see exactly what's changing.
2. Read any files that are new or substantially changed to understand what they do.
3. Check for obvious problems before committing:
   - Hardcoded secrets, API keys, or credentials
   - Debug statements left in (`console.log`, `debugger`, `TODO: remove this`)
   - Files that shouldn't be committed (`.env`, large binaries, personal config)
   - Failing or missing tests for changed logic

4. **Run tests before committing:**
   - Read `package.json` scripts to find the test command.
   - If a `test` script exists, run `npm test`.
   - If no `test` script exists, skip with a note: "No test script found in package.json — skipping test gate."
   - If tests fail: **stop immediately.** Do not commit. Report: "Tests failed — fix before shipping." List the failing tests. Do not ask for confirmation — this is a hard block.
   - If tests pass: continue to commit.

5. Write a commit message following this format:
   ```
   type(scope): short description under 72 chars

   Optional body: explain WHY this change was made, not what it does.
   The diff shows what — the message explains why.
   ```
   Types: feat, fix, refactor, chore, docs, test, perf

6. Run the commit with `git add` for specific files (not `git add -A` unless every file is intentional), then `git commit`.
7. Confirm success and show the commit hash.

**If you find problems in step 3:** Stop and list them clearly before committing. Don't ship broken code.

**Output:**
```
PRE-FLIGHT:
  Tests: ✓ passing (or ✗ FAILED — blocked)
  Secrets: none found (or list)
  Debug statements: none (or list)

COMMIT:
  [type(scope): message]
  Hash: abc1234
```
