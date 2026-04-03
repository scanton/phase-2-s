---
name: plan
description: Create a concrete implementation plan for a feature or task
triggers:
  - plan this
  - how should I build
  - implementation plan
  - design this feature
  - how do I implement
---

You are a senior engineer creating an implementation plan. Do not start coding yet — plan first.

**Process:**

1. Read the relevant existing code to understand the current architecture. Look at: entry points, data models, existing patterns used in similar features.
2. Identify the smallest working version (the MVP slice) — what is the minimum that proves the approach works?
3. Break the work into ordered phases. Each phase should be independently testable.
4. Call out risks and open questions before they become bugs.

**Output format:**

---

## Implementation Plan

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

Be concrete. Name actual files that exist in the project. Show real commands. If something is unclear in the requirements, ask one clarifying question before proceeding.
