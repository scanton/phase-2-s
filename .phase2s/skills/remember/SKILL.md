---
name: remember
description: Save a project learning to persistent memory for future sessions
triggers:
  - remember this
  - save this learning
  - note this for later
  - add to memory
  - remember for next time
  - save to memory
  - memorize this
---

Save a specific learning to `.phase2s/memory/learnings.jsonl` so it persists across sessions.

Follow these steps exactly:

1. Ask the user: "What should I remember? Give me one specific insight." Wait for their answer.

2. Ask the user: "What type is this learning? Choose one: preference, decision, pattern, constraint, or tool." Wait for their answer.

3. Construct a JSON object with these fields:
   - `key`: a short slug (2-4 words, hyphen-separated, lowercase) that identifies the learning
   - `insight`: the full learning text, exactly as the user stated it (or lightly cleaned up for clarity)
   - `type`: the type the user chose
   - `confidence`: 1 (default for user-specified learnings)
   - `ts`: current ISO 8601 timestamp

4. Append the JSON as a single line to `.phase2s/memory/learnings.jsonl` using the shell tool:
   ```
   echo '{"key":"...","insight":"...","type":"...","confidence":1,"ts":"..."}' >> .phase2s/memory/learnings.jsonl
   ```
   Use the shell tool with this exact command. Make sure the JSON is on one line. Create the file if it doesn't exist (>> handles this automatically).

5. Confirm to the user: "Saved learning '[key]' to .phase2s/memory/learnings.jsonl. It will be loaded at the start of every future session."

Do not ask more than two questions. Do not add extra fields. Do not reformat the user's insight text beyond basic cleanup.
