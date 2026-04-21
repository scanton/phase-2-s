---
name: skill
description: Create a new Phase2S skill — guided interview, generates a SKILL.md file
model: fast
triggers:
  - create a skill
  - new skill
  - add a skill
  - make a skill
  - create skill
  - build a skill
---

Create a new Phase2S skill by interviewing the user and writing a `SKILL.md` file.

Follow these steps exactly:

1. Ask the user: "What should this skill do? Describe it in one sentence." Wait for their answer.

2. Ask the user: "What phrases should trigger this skill? Give me 3 to 5 examples of what you'd type." Wait for their answer.

3. Ask the user: "Does this skill need extra intelligence? Choose: default (uses your config model), fast (lighter/cheaper model), or smart (more capable model)." Wait for their answer. If they say "default" or aren't sure, omit the model field.

4. Ask the user: "Does this skill make code changes or write files?" (yes / no). Wait for their answer. This determines which structural sections the template gets.

5. Generate the skill name from their description: lowercase, hyphens for spaces, no special characters, 1-3 words (e.g. "format-check", "deploy", "summarize").

6. Write the SKILL.md file to `.phase2s/skills/<name>/SKILL.md` using the file-write tool. Use this template, substituting the user's answers and including only the sections that apply:

```
---
name: {name}
description: {one-line description from user}
triggers:
  - {trigger phrase 1}
  - {trigger phrase 2}
  - {trigger phrase 3}
{model line if not default: "model: fast" or "model: smart"}
{inputs block if the skill takes arguments — see format below}
---

{Clear, single-pass instruction explaining what the skill does and how to execute it.

Write this as a direct instruction to the model:
- State the goal
- List the steps to execute
- Be concrete: name files, commands, formats}

## Output

{Describe the output format here. Use a code block to show the exact structure, e.g.:
```
RESULT: [summary]
CHANGES: [list of files modified]
```
}

{Include this section only if the skill makes code changes:}
## Verify

Run `npm test` to confirm nothing broke. Report:
- ✓ Tests passing — skill complete.
- ✗ Tests failed — list failures and fix before finishing.

{Include this section only if the skill writes artifacts:}
## Save

Use the `shell` tool to get the current datetime (`date +%Y-%m-%d-%H%M`), then save output to `.phase2s/{name}/<datetime>-<slug>.md`. Create the directory first: `mkdir -p .phase2s/{name}/`. Tell the user the path.
```

**inputs block format** (include in frontmatter only if the skill takes named arguments):
```yaml
inputs:
  arg_name:
    prompt: "Question to ask the user for this argument"
```
Then use `{{arg_name}}` in the skill body where the value belongs.

7. Tell the user: "Skill '/{name}' created at .phase2s/skills/{name}/SKILL.md. Run `phase2s skills` to verify it loaded."

Do not ask more than four questions. Write the file in one step using file-write.
