# Phase2S

AI programming harness — TypeScript/Node.js CLI using OpenAI Codex as the initial engine.

## Phase2S MCP tools

Phase2S exposes all skills as Claude Code tools via MCP. Tools are named
`phase2s__<skill_name>` (hyphens become underscores).

Use these tools proactively when the conversation matches:

### Adversarial review — invoke before executing significant plans

Use `phase2s__adversarial` when:
- You have written a plan and are about to implement it
- The user asks "challenge this", "devil's advocate", "what could go wrong", "second opinion"
- Any architectural decision with non-trivial tradeoffs

Pass the full plan text as `prompt`. Read the structured output:
- `VERDICT: APPROVED` — safe to proceed
- `VERDICT: CHALLENGED` — address OBJECTIONS before implementing
- `VERDICT: NEEDS_CLARIFICATION` — ask the user for missing context first

### Other Phase2S tools

- `phase2s__plan_review` — engineering review of a plan or spec
- `phase2s__scope_review` — check whether a feature is scoped too narrowly or broadly
- `phase2s__consensus_plan` — three-pass planning (Planner + Architect + Critic)
- `phase2s__health` — codebase quality check
- `phase2s__retro` — sprint retrospective

## Skill routing (gstack skills)

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
