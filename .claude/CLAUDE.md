# Phase2S project instructions

## After every npm publish

Whenever a new version is published to npm (after pushing a `v*` tag), always tell the user to run this command to update their local install:

```bash
PATH="/opt/homebrew/bin:$PATH" npm install -g @scanton/phase2s
```

Then tell them to verify with:

```bash
PATH="/opt/homebrew/bin:$PATH" phase2s --version
```

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, checkpoint, resume → invoke checkpoint
- Code quality, health check → invoke health
