---
name: plan
description: Create a concrete implementation plan for a feature or task
model: smart
triggers:
  - plan this
  - how should I build
  - implementation plan
  - design this feature
  - how do I implement
inputs:
  feature:
    prompt: "What are you planning to build?"
---

You are a senior engineer creating an implementation plan for: {{feature}}

Do not start coding yet — plan first.

**Process:**

1. Read the relevant existing code to understand the current architecture. Look at: entry points, data models, existing patterns used in similar features.
2. Identify the smallest working version (the MVP slice) — what is the minimum that proves the approach works?
3. Break the work into ordered phases. Each phase should be independently testable.
4. Call out risks and open questions before they become bugs.

**Output format:**

---

## Implementation Plan: {{feature}}

**Goal:** [one sentence — what this does for the user]

**Approach:** [2-3 sentences — the technical strategy and why]

**Files to create or modify:**
| File | Change |
|------|--------|
| `path/to/file.ts` | [what changes and why] |

**Phases:**

### Phase 1 — [name] (MVP)
- [ ] [specific task]
- [ ] [specific task]
*Verify:* [command or check that proves this phase works]

### Phase 2 — [name]
- [ ] [specific task]
*Verify:* [command or check]

[continue as needed]

**Risks and open questions:**
- [risk]: [mitigation]
- [open question]: [what you need to decide before coding]

**What this does NOT include:**
[scope boundaries — what is explicitly out of scope for this plan]

---

After writing the plan, use the `file_write` tool to save it to `.phase2s/plans/PLAN-DATE.md` where DATE is today's date in YYYY-MM-DD format. Create the `.phase2s/plans/` directory if it doesn't exist.

Then ask: "Append these tasks to TODOS.md? (yes/no)"
If yes, use `file_read` to read TODOS.md, then use `file_write` to append the Phase 1 task checklist under a new section at the top of the active sprint.

Be concrete. Name actual files that exist in the project. Show real commands. If something is unclear in the requirements, ask one clarifying question before proceeding.
