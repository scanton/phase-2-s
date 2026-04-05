# Writing Custom Skills

Drop a Markdown file in `.phase2s/skills/` and it becomes a `/command` immediately. No restart needed. No code changes.

---

## SKILL.md format

```
.phase2s/
  skills/
    my-skill/
      SKILL.md
```

**SKILL.md structure:**

```markdown
---
name: my-skill
description: One line describing what this skill does
model: fast
retries: 0
triggers:
  - phrase that triggers this skill
  - another trigger phrase
---

Your prompt template goes here. This is exactly what gets sent to the model
before the user's message. Write what you want the model to do, in the format
you want it to respond in. Be specific.

The user's arguments are appended automatically:
- /my-skill src/auth.ts    → prompt + "Focus on this file: src/auth.ts"
- /my-skill why is X slow  → prompt + "Additional context: why is X slow"
```

---

## Frontmatter fields

### `name` (required)

The slash command name. `name: my-skill` creates `/my-skill`.

Use lowercase with hyphens. No spaces, no underscores.

```yaml
name: diff-summary
name: sec-review
name: explain-error
```

### `description` (required)

One sentence. This shows up in `phase2s skills` output and in Claude Code's tool list.

```yaml
description: Summarize the current git diff for a non-technical reviewer.
```

### `model` (optional)

Which model to use. Three forms:

```yaml
model: fast    # uses config.fast_model (requires Option B)
model: smart   # uses config.smart_model (requires Option B)
model: gpt-4o  # literal model name, always uses this model
```

If omitted, uses the default model from config.

`fast` and `smart` tier routing only applies when using `PHASE2S_PROVIDER=openai-api` (Option B). With Option A (Codex CLI), all skills use whatever model Codex is configured to use. See [advanced.md](advanced.md).

### `retries` (optional)

Number of retry attempts for the satori loop. Default: `0` (off).

```yaml
retries: 3
```

Set this to make your skill run like `/satori` — implement, verify, retry on failure. The verify command is `npm test` unless you configure `verifyCommand` in `.phase2s.yaml`.

### `triggers` (optional)

Phrases that invoke this skill when typed in plain English (not as a `/command`). The skill also responds to `/name` regardless of triggers.

```yaml
triggers:
  - summarize changes
  - explain the diff
  - what changed in plain English
  - PR summary
  - summarize for review
```

When you type "summarize changes" in the REPL, Phase2S matches it against all skill triggers and invokes the skill.

### `inputs` (optional)

Named inputs the skill needs before running. Each input corresponds to a `{{key}}` placeholder in the prompt template.

In **REPL mode**, Phase2S prompts the user for each declared input before running. In **MCP mode** (Claude Code), each input becomes a typed tool parameter.

```yaml
inputs:
  feature:
    prompt: "What feature are you planning?"
  include_tests:
    prompt: "Include test tasks? (yes/no)"
    type: boolean
  output_format:
    prompt: "Output format"
    type: enum
    enum:
      - prose
      - bullet-points
      - table
  max_items:
    prompt: "Max items to return"
    type: number
```

**Prompt body uses `{{key}}` placeholders:**

```
Plan the {{feature}} feature.
Include tests: {{include_tests}}
Format: {{output_format}}
```

**`type` field** (optional, default `string`):

| Type | MCP schema | Template value |
|------|------------|----------------|
| `string` | `{ "type": "string" }` | string as-is |
| `boolean` | `{ "type": "boolean" }` | `"true"` or `"false"` |
| `number` | `{ "type": "number" }` | number as string |
| `enum` | `{ "type": "string", "enum": [...] }` | one of the enum values |

All values are converted to strings before template substitution. A `boolean` input with value `true` becomes `"true"` in the template.

**`enum` field** (only valid when `type: enum`): list of allowed values. If absent or empty when `type` is `enum`, Phase2S falls back to `type: string`.

**One-shot mode (`phase2s run`)**: skill inputs are not prompted interactively. Unfilled `{{key}}` placeholders remain in the template — the model sees them as context and handles them gracefully.

---

## Skill search order

Phase2S loads skills from three locations. First match wins — earlier locations override later ones.

1. `.phase2s/skills/` in your current project
2. `~/.phase2s/skills/` for skills available in every project
3. `~/.codex/skills/` Codex CLI's native skill directory

Anything you've already written for Codex CLI works in Phase2S automatically.

**Deduplication:** if two locations define a skill with the same name, the earlier location wins. Project skills override global skills. Global Phase2S skills override Codex skills.

---

## Example: basic review skill

A focused security review skill:

```markdown
---
name: sec-review
description: Security-focused code review. Looks for injection, auth bypass, secrets, and unsafe patterns.
model: smart
triggers:
  - security review
  - sec review
  - check for vulnerabilities
  - security audit this file
---

Review the specified file or directory for security issues only. Skip style and
performance concerns — focus entirely on security.

For each finding, format as:

  SEVERITY: [CRIT|HIGH|MED|LOW]
  CONFIDENCE: [VERIFIED|UNVERIFIED]
  LOCATION: file:line
  FINDING: what the issue is
  EXPLOIT: one concrete scenario showing how this could be exploited
  FIX: the minimal fix

Check specifically for:
- Hardcoded secrets or API keys
- SQL injection or command injection via user input
- Auth bypass (missing checks, JWT not verified, etc.)
- Path traversal (user input in file paths)
- Unsafe deserialization
- Dependency issues (obvious known-bad patterns)

If no issues are found, say so explicitly.
```

Usage:

```
you > /sec-review src/api/
you > security review src/core/agent.ts
```

---

## Example: satori skill (with retries)

A skill that implements a feature and keeps going until tests pass:

```markdown
---
name: add-tests
description: Add missing tests for a file or function, then verify they pass.
model: smart
retries: 3
triggers:
  - add tests for
  - write tests for
  - test coverage for
---

Add missing tests for the specified file or function.

Process:
1. Read the target file. Identify all public functions, exported classes, and
   edge cases that are not currently tested.
2. Write tests using the project's existing test framework (detect from package.json).
3. Run the tests to confirm they pass.
4. If tests fail, read the error and fix either the test or the implementation
   (prefer fixing the test unless the implementation has a real bug).

Format: mirror the existing test file structure in the same directory.
Do not modify the implementation file unless a test reveals a genuine bug.
Report: number of tests added, coverage delta if available.
```

Usage:

```
you > /add-tests src/utils/rate-limiter.ts
you > add tests for the RateLimiter class
```

Because `retries: 3`, Phase2S will run `npm test` after writing the tests, and retry up to 3 times if they fail.

---

## Using `/skill` to create skills interactively

The fastest way to create a skill is to ask Phase2S to make one:

```
you > /skill

assistant > What should this skill do? One sentence.
you > Review a database migration file for safety: no data loss, no missing rollbacks, reversible.

assistant > What phrases trigger this skill?
you > review migration, check this migration, migration safety, review this SQL migration

assistant > Which model tier?
you > smart

assistant > Skill '/migration-review' created at .phase2s/skills/migration-review/SKILL.md
```

Phase2S writes the SKILL.md with a sensible prompt based on your description. Then you can open the file and refine it if you want more control over the exact output format.

---

## Tips for writing good skill prompts

**Be specific about output format.** The model will follow your format template. Show exactly what you want:

```
For each issue, use this exact format:
  SEVERITY: CRIT|HIGH|MED|LOW
  FILE: path:line
  ISSUE: one sentence
  FIX: the minimal fix
```

**Give the model a clear stopping condition.** "Review these files and stop" is better than open-ended instructions.

**Use `model: smart` for review and planning skills.** Use `model: fast` for quick summarization or simple transformations. The cost difference is significant at scale.

**Add `retries: 3` to any skill that writes code.** Writing code without running tests is speculative. Make the skill verify its own work.

**Keep the prompt template focused.** One skill, one purpose. If you find yourself writing "and also...", split it into two skills.

**Test your skill with an argument and without.** The user's argument appends to your prompt. Make sure the prompt reads correctly both ways:

```
you > /diff-summary               — prompt only
you > /diff-summary src/auth.ts   — prompt + "Focus on this file: src/auth.ts"
```
