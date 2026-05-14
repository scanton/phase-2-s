# Migrating to phase2s v2.0

## Summary

**There are no breaking changes.**

All v1.x CLI commands, config files, and conduct log formats are unchanged.
The major version bump marks the web dashboard (`phase2s serve`) as the flagship
feature — not a breaking API change.

## What's new in v2.0

| Feature | Where |
|---------|-------|
| Search/filter on Runs page | Dashboard → Runs |
| Project organization (group by git root) | Dashboard → Runs |
| Help page with CLI reference | Dashboard → Help (`/help`) |
| `GET /api/runs` query params | API (additive) |

## Upgrade

```bash
npm install -g @scanton/phase2s
phase2s --version  # should print 2.0.0
```

## API changes (additive only)

`GET /api/runs` now accepts optional query parameters:

| Param | Type | Description |
|-------|------|-------------|
| `?search=<text>` | string | Case-insensitive substring match on goal |
| `?status=success\|failure` | string | Filter by terminal status |
| `?after=<ISO 8601>` | string | Runs started after this timestamp |
| `?before=<ISO 8601>` | string | Runs started before this timestamp |

Existing callers with no params continue to receive all entries, newest first.
Invalid param values return HTTP 400 with a descriptive error message.

## Conduct log compatibility

No changes to `.phase2s/conduct-log.jsonl`. Existing log entries are fully
compatible with v2.0 — project grouping reads the existing `specPath` field.

## Config file compatibility

`.phase2s.yaml` format is unchanged.
