# Contributing to Phase2S

## Running the tests

```bash
# Node.js unit tests (root package)
npm test

# Web component tests (React, jsdom, axe)
npm run test:web

# Both at once
npm run test:all
```

`npm run test:web` runs `cd web && npm run test:web` — Vitest with the `web/vitest.config.ts` config (jsdom environment, `@testing-library/react`, `vitest-axe` matchers). The web tests are separate from the root Node.js tests and require the `web/` dependencies to be installed (`npm install` inside `web/` or `npm run build:web` from the root).

## Session Storage

Session files live at `.phase2s/sessions/<uuid>.json`. Concurrent writes are
serialized with POSIX exclusive-create locks (`.state.lock`, `.index.lock`).
The lock implementation uses `{ flag: "wx" }` which is atomic on local POSIX
filesystems (Linux, macOS) but is NOT guaranteed atomic on NFSv2/v3 mounts.
If you are running Phase2S on an NFS-mounted home directory and need strict
lock correctness, consider a fencing token or a distributed lock service.
