---
name: unfreeze
description: Clear the active edit directory restriction set by /freeze or /guard
triggers:
  - unfreeze
  - unlock edits
  - remove freeze
  - allow all edits
  - clear freeze
  - unfreeze edits
  - remove edit restriction
---

Clear the edit directory restriction for this session.

Confirm: "Edit restriction cleared. I can now create and modify files anywhere in the project, subject to the sandbox (no edits outside the project directory) and the `allowDestructive` config setting."

If safety mode (/careful) was also active separately, note: "Note: destructive command confirmation is still active if you enabled it with `/careful`. Say 'turn off safety mode' to disable that."

The freeze is now lifted for the rest of this session.
