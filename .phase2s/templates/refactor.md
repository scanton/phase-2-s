---
title: Refactor Module
description: Improve the internal structure of a module without changing external behavior
placeholders:
  - module_name
  - problem_description
  - test_command
---
# Refactor {{module_name}}

## Problem Statement

{{module_name}} has accumulated technical debt: {{problem_description}}. External behavior must stay identical — this is a pure internal restructuring. All existing tests must pass after every subtask.

## Acceptance Criteria

- [ ] All existing tests pass before and after refactor
- [ ] No external API changes (same function signatures, same exports)
- [ ] Cyclomatic complexity reduced — no function over 20 lines
- [ ] No new lint errors
- [ ] Code review shows clear improvement in readability

## Constraints

### Must Do
- Keep the external API identical
- Run tests after each subtask — stop if any fail

### Cannot Do
- Change exported function signatures
- Remove existing behavior (even undocumented edge cases)

### Should Prefer
- Small, focused commits per subtask
- Extract pure functions that are easy to unit test

### Should Escalate
- If a test was already broken before the refactor — document and skip, don't fix it here

## Decomposition

### 1. Characterization tests
Input: current {{module_name}} behavior
Output: tests that capture all existing behavior (including edge cases)
Success criteria: 100% of current behavior documented in tests; {{test_command}} passes

### 2. Extract pure functions
Input: {{module_name}} with characterization tests from subtask 1
Output: side-effect-free functions extracted from the main module
Success criteria: extracted functions have their own unit tests; no behavior change

### 3. Simplify control flow
Input: {{module_name}} after subtask 2
Output: flattened conditions, early returns replacing deeply nested blocks
Success criteria: max function length ≤ 20 lines; {{test_command}} still passes

### 4. Clean up naming and comments
Input: {{module_name}} after subtask 3
Output: consistent naming, updated JSDoc, removed misleading comments
Success criteria: no TODO comments left; lint passes; {{test_command}} passes

## Evaluation Design

### Test: behavior preservation
Input: same inputs as before refactor
Expected: identical outputs to pre-refactor baseline

### Test: no regressions
Input: full test suite
Expected: {{test_command}} exits 0

evalCommand: {{test_command}}
