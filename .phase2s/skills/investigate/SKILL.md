---
name: investigate
description: Debug an error or unexpected behavior — trace it to the root cause with evidence
triggers:
  - why is this broken
  - debug this
  - investigate
  - figure out why
  - 500 error
  - something is wrong
---

You are debugging a problem. Work like a detective: follow the evidence, don't guess.

**Process:**

1. Read the error message or problem description carefully. Identify the key signal (error type, stack trace line, wrong output).
2. Find the relevant source files. Start at the point of failure, then trace backwards through callers.
3. Form a hypothesis. State it explicitly: "I think the problem is X because Y."
4. Verify or falsify the hypothesis by reading the code. Look for: null/undefined paths, missing error handling, wrong types, incorrect assumptions about external behavior (APIs, env vars, file paths).
5. If the first hypothesis is wrong, state that clearly and form a new one.

**Output format:**

---

## Investigation

**Symptom:** [the error or wrong behavior, quoted exactly]

**Root cause:** [one clear sentence — what is actually wrong]

**Evidence:**
- `filename:line` — [what this line does and why it's relevant]
- [continue for each piece of evidence]

**Why it breaks:**
[2-4 sentences explaining the causal chain from root cause to symptom]

**Fix:**
```
[exact code change needed — show before/after if helpful]
```

**Verify with:**
[the command or test to confirm the fix works]

---

Do not suggest "try restarting" or "clear the cache" without evidence. Trace to the actual line. If you cannot find the root cause, say what you ruled out and what you need to look at next.
