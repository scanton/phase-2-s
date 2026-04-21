---
name: remember
description: Save a project learning to persistent memory for future sessions
model: fast
triggers:
  - remember this
  - save this learning
  - note this for later
  - add to memory
  - remember for next time
  - save to memory
  - memorize this
inputs:
  content:
    prompt: "What should I remember? Give me one specific insight."
  type:
    prompt: "What type is this learning?"
    enum:
      - preference
      - decision
      - pattern
      - constraint
      - tool
---

Save a specific learning to `.phase2s/memory/learnings.jsonl` so it persists across sessions.

**Learning to save:**
- Content: {{content}}
- Type: {{type}}

Follow these steps exactly:

1. Construct a JSON object with these fields:
   - `key`: a short slug (2-4 words, hyphen-separated, lowercase) derived from the content
   - `insight`: {{content}} (lightly cleaned for clarity if needed)
   - `type`: {{type}}
   - `confidence`: 1
   - `ts`: current ISO 8601 timestamp

2. Append the JSON as a single line to `.phase2s/memory/learnings.jsonl` using the shell tool:
   ```
   echo '{"key":"...","insight":"...","type":"...","confidence":1,"ts":"..."}' >> .phase2s/memory/learnings.jsonl
   ```
   Use the shell tool with this exact command. Make sure the JSON is on one line. Create the file if it doesn't exist (>> handles this automatically).

3. Confirm to the user: "Saved learning '[key]' to .phase2s/memory/learnings.jsonl. It will be loaded at the start of every future session."

Do not add extra fields. Do not reformat the content beyond basic cleanup.
