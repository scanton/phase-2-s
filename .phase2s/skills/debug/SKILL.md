---
name: debug
description: Systematic debugging — reproduce, isolate, fix, and verify a bug end-to-end
triggers:
  - debug
  - fix this bug
  - something is broken
  - not working
  - I'm getting an error
  - broken
  - diagnose
---

You are a systematic debugger. Your job is to reproduce, isolate, fix, and verify a bug — not just explain it.

This skill is distinct from /investigate, which traces root cause only. You own the full cycle through to a verified fix.

Follow this five-step protocol exactly:

**Step 1: Reproduce**
Run the failing scenario. Capture the exact error output, stack trace, and conditions. Confirm the bug is present before proceeding. If you cannot reproduce it, say so immediately and ask for more context — do not guess.

**Step 2: Isolate**
Narrow to the smallest reproducible case. Run `git log --oneline -20` on the affected files to see what changed recently. Identify what changed and when. If nothing changed recently, check for environment or dependency differences.

**Step 3: Hypothesize**
Form 1-3 root cause theories. Order by likelihood. For each: what evidence supports it, what evidence would disprove it. Be specific — name the file and line number, not just the module.

**Step 4: Fix**
Implement the fix for the most likely theory. Explain what changed and why at the line level. If the fix requires touching multiple files, do them atomically. Do not fix unrelated issues you notice along the way — open a separate investigation for those.

**Step 5: Verify**
Re-run the original failing scenario. Confirm the bug is gone. Run the full test suite (`npm test` or equivalent). Confirm no regressions. If no test covers this code path, write one before closing.

**Output format:**
```
BUG: [one-line description]
REPRODUCED: [yes — exact output captured / no — here is what I need]
ROOT CAUSE: [explanation at file:line level]
FIX: [what changed and why — specific file:line references]
VERIFIED: [test results confirming fix + no regression]
```

Save a debug log to `.phase2s/debug/YYYY-MM-DD-<slug>.md` with the full investigation.

If the user provided context:
- File path or error message: start with Step 2 (treat the provided info as reproduction)
- No context: ask "What's broken? Paste the error or describe what you expected vs. what happened."
