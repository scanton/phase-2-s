---
title: Test Coverage
description: Write missing tests for an existing module to reach a coverage target
placeholders:
  - module_name
  - coverage_target
  - test_command
---
# Test Coverage for {{module_name}}

## Problem Statement

{{module_name}} has insufficient test coverage. Untested paths create risk for every future change. Add tests to reach {{coverage_target}}% coverage without modifying production code.

## Acceptance Criteria

- [ ] Coverage for {{module_name}} reaches {{coverage_target}}%
- [ ] All edge cases documented (even if deferred)
- [ ] No production code modified — tests only
- [ ] Tests are readable: each test name describes the scenario
- [ ] {{test_command}} exits 0

## Constraints

### Must Do
- Test edge cases, not just happy paths
- Each test must have a clear, readable name

### Cannot Do
- Modify production code to make tests pass
- Write tests that test implementation details (not behavior)

### Should Prefer
- Group related tests in describe() blocks
- Use table-driven / parameterized tests for multiple similar cases

### Should Escalate
- If production code has a bug discovered during testing — file a separate fix, don't patch here

## Decomposition

### 1. Coverage audit
Input: current {{module_name}} test file (or lack of one)
Output: list of untested code paths and edge cases
Success criteria: every branch in {{module_name}} is accounted for (tested or explicitly deferred)

### 2. Happy path tests
Input: audit from subtask 1
Output: tests for the main success scenarios
Success criteria: {{test_command}} passes; coverage improves

### 3. Error and edge case tests
Input: audit from subtask 1, happy path tests from subtask 2
Output: tests for error conditions, boundary values, null/undefined inputs
Success criteria: {{test_command}} passes; coverage reaches {{coverage_target}}%

### 4. Documentation
Input: completed test file
Output: comment at top of test file listing known untested paths and why
Success criteria: any future engineer can see what is and isn't covered

## Evaluation Design

### Test: coverage gate
Input: run test suite with coverage
Expected: {{module_name}} coverage ≥ {{coverage_target}}%

### Test: no regressions
Input: full test suite
Expected: {{test_command}} exits 0

evalCommand: {{test_command}}
