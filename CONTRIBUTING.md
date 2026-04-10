# Contributing to Phase2S

## Session Storage

Session files live at `.phase2s/sessions/<uuid>.json`. Concurrent writes are
serialized with POSIX exclusive-create locks (`.state.lock`, `.index.lock`).
The lock implementation uses `{ flag: "wx" }` which is atomic on local POSIX
filesystems (Linux, macOS) but is NOT guaranteed atomic on NFSv2/v3 mounts.
If you are running Phase2S on an NFS-mounted home directory and need strict
lock correctness, consider a fencing token or a distributed lock service.
