---
name: ship
description: Prepare and execute a clean commit — review the diff, write the message, check nothing's broken
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
4. Write a commit message following this format:
   ```
   type(scope): short description under 72 chars

   Optional body: explain WHY this change was made, not what it does.
   The diff shows what — the message explains why.
   ```
   Types: feat, fix, refactor, chore, docs, test, perf
5. Run the commit with `git add` for specific files (not `git add -A` unless every file is intentional), then `git commit`.
6. Confirm success and show the commit hash.

**If you find problems:** Stop and list them clearly before committing. Don't ship broken code.

**Output:** Show the final commit message before executing, then confirm the commit hash after.
