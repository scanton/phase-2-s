---
name: skill
description: Create a new Phase2S skill — guided interview, generates a SKILL.md file
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

4. Generate the skill name from their description: lowercase, hyphens for spaces, no special characters, 1-3 words (e.g. "format-check", "deploy", "summarize").

5. Write the SKILL.md file to `.phase2s/skills/<name>/SKILL.md` using the file-write tool. Use this exact template, substituting the user's answers:

```
---
name: {name}
description: {one-line description from user}
triggers:
  - {trigger phrase 1}
  - {trigger phrase 2}
  - {trigger phrase 3}
{model line if not default: "model: fast" or "model: smart"}
---

{Clear, single-pass instruction explaining what the skill does and how to execute it.

Write this as a direct instruction to the model:
- State the goal
- List the steps to execute
- Specify the output format
- Do NOT ask interactive questions unless the skill is explicitly designed for it
- Be concrete: name files, commands, formats}
```

Fill in the prompt content based on the user's description of what the skill should do. Make it a clear, actionable instruction.

6. Tell the user: "Skill '/{name}' created at .phase2s/skills/{name}/SKILL.md. Run `phase2s skills` to verify it loaded."

Do not ask more than three questions. Write the file in one step using file-write. Do not show the user the file contents before writing — just write it.
