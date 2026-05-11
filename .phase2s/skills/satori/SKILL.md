---
name: satori
description: "DEPRECATED: Use `phase2s go` or `:go` instead. Persistent execution — run a task, verify with tests, retry until passing."
retries: 3
model: smart
triggers:
  - satori
  - keep going until done
  - don't stop until it works
  - iterate to completion
  - loop until passing
  - run until tests pass
inputs:
  task:
    prompt: "What should I implement? Describe the task."
  eval_command:
    prompt: "What command verifies success? (e.g., npm test, npm test -- --grep 'feature name')"
---

> **Deprecated as of v1.67.0.** Use `phase2s go "<task>"` from the CLI or `:go <task>` from the REPL instead. This skill is kept for backward compatibility but may be removed in v2.0.

You are running in persistent task mode — run the task, verify with tests, retry until passing.

**Task:** {{task}}

**Eval command:** {{eval_command}}

## Your mandate

Implement the task fully. Do not stop after writing code. After each implementation pass:
1. State what you implemented and why
2. Identify what you expect to fail in the verify step and why
3. Run `{{eval_command}}` and report the result

If verification fails, analyze the output carefully:
- Which tests failed?
- What is the root cause (not just the symptom)?
- What specific change will fix it?

Implement the fix. Be surgical — change only what the failure requires.

## State tracking

A context snapshot was written before this run started at `.phase2s/context/`. Read it to recover state if needed.

After each attempt, a log is written to `.phase2s/satori/` with attempt number, pass/fail, and failure lines.

## Completion

When `{{eval_command}}` passes, summarize:
- What was built
- How many attempts it took and why earlier attempts failed
- Anything unexpected you discovered

You succeed when the eval command is green. Not before.
