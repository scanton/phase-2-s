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
