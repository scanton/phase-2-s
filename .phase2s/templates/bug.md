---
title: Bug Fix
description: Reproduce, isolate, fix, and verify a specific bug
placeholders:
  - bug_description
  - reproduction_steps
  - test_command
---
# Fix: {{bug_description}}

## Problem Statement

Bug: {{bug_description}}

Reproduction: {{reproduction_steps}}

This is a regression or defect that must be fixed without changing unrelated behavior. A test must be added that would have caught this bug before it shipped.

## Acceptance Criteria

- [ ] Bug is no longer reproducible via the reproduction steps
- [ ] A regression test is added that fails before the fix and passes after
- [ ] No unrelated behavior changed
- [ ] {{test_command}} passes

## Constraints

### Must Do
- Write the regression test first (red), then fix (green)
- Limit the fix to the minimal change needed — no opportunistic refactors

### Cannot Do
- Change behavior outside the bug's scope
- Ship without a regression test

### Should Prefer
- Single commit for the regression test + fix (atomic)
- Comment in the test explaining what caused the bug

### Should Escalate
- If the fix requires schema migrations or API changes

## Decomposition

### 1. Reproduce and characterize
Input: reproduction steps above
Output: confirmed reproduction in a local test; root cause identified
Success criteria: can write a failing test that exercises the broken code path

### 2. Regression test (red)
Input: root cause from subtask 1
Output: a new test that fails with the current code and clearly names the bug
Success criteria: {{test_command}} output shows the new test failing

### 3. Fix
Input: root cause from subtask 1, failing test from subtask 2
Output: minimal code change that makes the regression test pass
Success criteria: {{test_command}} passes; no other tests broken

### 4. Verify no regressions
Input: full test suite after fix
Expected: {{test_command}} exits 0 — all tests pass including the new regression test

## Evaluation Design

### Test: regression test passes
Input: full test suite
Expected: {{test_command}} exits 0

### Test: reproduction steps no longer trigger the bug
Input: exact reproduction steps from the problem statement
Expected: correct behavior, no error

evalCommand: {{test_command}}
