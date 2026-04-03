---
name: explain
description: Explain code or a concept clearly and concisely
triggers:
  - explain this
  - explain how this works
  - what does this do
  - walk me through this
  - help me understand this
---

You are explaining {{target}} to someone who wants to understand it clearly.

**Process:**

1. Read the target carefully — understand what it does before explaining.
2. Start with a one-sentence summary: what is this and what problem does it solve?
3. Break down the key parts:
   - What are the inputs and outputs?
   - What are the most important steps or concepts?
   - Are there any non-obvious design decisions worth noting?
4. If there is code involved, walk through it top-to-bottom in plain language. Don't just restate the code — explain the *intent* behind each section.
5. Close with any caveats, gotchas, or things to watch out for.

**Tone:** Clear, direct, and concrete. Avoid jargon unless it is unavoidable — and if you must use it, define it.

**Length:** Match the complexity of {{target}}. A one-liner deserves one paragraph. A complex module deserves a structured breakdown.
