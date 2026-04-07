---
title: CLI Subcommand
description: Add a new subcommand to an existing CLI tool with argument parsing and tests
placeholders:
  - command_name
  - command_description
  - test_command
---
# Add `{{command_name}}` Subcommand

## Problem Statement

The CLI is missing a `{{command_name}}` subcommand. Users currently have to {{command_description}} manually. Adding it as a first-class CLI command makes it discoverable, scriptable, and consistent with other subcommands.

## Acceptance Criteria

- [ ] `cli {{command_name}} --help` prints usage
- [ ] Happy path runs and exits 0
- [ ] Invalid arguments print a useful error and exit 1
- [ ] `--dry-run` flag shows what would happen without side effects (if applicable)
- [ ] Output format is consistent with other subcommands (same chalk usage, same error format)
- [ ] {{test_command}} passes with ≥80% coverage on the new module

## Constraints

### Must Do
- Use the existing CLI framework (Commander/yargs/etc) — match the project's pattern
- Match error output format of existing commands
- Export pure logic functions for testability

### Cannot Do
- Add new runtime dependencies
- Change existing subcommand behavior

### Should Prefer
- Thin command handler that delegates to a pure function
- Tests at the pure function level, not the CLI entry point

### Should Escalate
- If the command needs a config file field that doesn't exist yet

## Decomposition

### 1. Command registration
Input: existing CLI entry point (index.ts or equivalent)
Output: `{{command_name}}` subcommand registered with Commander/yargs, --help works
Success criteria: `cli {{command_name}} --help` prints usage; no other behavior yet

### 2. Core logic
Input: command requirements
Output: pure `run{{command_name}}()` function in `src/cli/{{command_name}}.ts`
Success criteria: function works correctly when called directly in tests

### 3. Wire command handler to core logic
Input: registration from subtask 1, logic from subtask 2
Output: command handler calls `run{{command_name}}()`, handles errors, exits correctly
Success criteria: end-to-end happy path works; invalid args exit 1

### 4. Tests
Input: `src/cli/{{command_name}}.ts` from subtask 3
Output: test file with happy path, invalid args, error cases
Success criteria: {{test_command}} passes; coverage ≥ 80%

## Evaluation Design

### Test: happy path
Input: valid arguments
Expected: exits 0, correct output

### Test: invalid arguments
Input: missing required arg
Expected: exits 1, helpful error message

### Test: --help
Input: `{{command_name}} --help`
Expected: exits 0, usage printed

evalCommand: {{test_command}}
