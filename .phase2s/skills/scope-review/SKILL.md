---
name: scope-review
description: Scope and ambition review — challenges whether the plan is doing the right thing at the right scale
model: smart
triggers:
  - think bigger
  - expand scope
  - strategy review
  - challenge the scope
  - is this ambitious enough
  - scope review
  - rethink this
  - is this the right approach
  - challenge my plan
---

Run a scope and ambition review on the current plan or design. This is not an implementation review (that's `/plan-review`) — this challenges whether we're solving the right problem at the right scale.

**First, ask what mode to use:**

Ask the user (AskUserQuestion if available, otherwise as plain text):

> Which mode?
> A) **Expand** — what's the 10x version of this? What are we leaving on the table?
> B) **Hold** — maximum rigor on the stated scope. Find what we're missing within it.
> C) **Reduce** — strip to absolute essentials. What can we cut?
> D) **Challenge** — adversarial mode. What's wrong with the fundamental approach?

Then read the plan file if provided, or gather context:
```bash
cat TODOS.md 2>/dev/null | head -60
git log --oneline -10
```

---

## Review Sections

### 1. Problem Definition
Is the problem being solved actually the right problem? Could a different framing unlock a better solution? What would have to be true for this to be wrong?

### 2. Scope Boundary
What's in scope? What's explicitly out of scope? What's ambiguously in between and likely to cause pain later? Name 3 things that will probably be "just one more thing" mid-implementation.

### 3. Long-term Trajectory
Does this decision close future doors or keep them open? What would a v2 look like? Does the v1 architecture support it?

### 4. What's Being Deferred
List everything in TODOS.md or marked "future" or "deferred." For each: is this actually deferrable or is it a hidden dependency on the current work?

### 5. The 10x Version (Expand mode only)
What would this look like if done at full ambition? What would it take to get there? Is there a smaller version of the 10x idea that could be included without blowing up scope?

### 6. The MVP (Reduce mode only)
What is the absolute minimum that delivers real value? What can be cut without losing the core value proposition? What's being built out of habit or convention rather than necessity?

### 7. The Adversarial Challenge (Challenge mode)
What's the most fundamental objection to this approach? What would a skeptic say? What would they be right about?

---

End with a verdict:
- **SCOPE IS RIGHT** — proceed
- **CONSIDER EXPANDING** — specific additions worth the cost
- **CONSIDER REDUCING** — specific cuts worth making
- **RETHINK FUNDAMENTALS** — something more significant needs to change
