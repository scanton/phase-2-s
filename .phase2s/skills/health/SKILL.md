---
name: health
description: Code quality dashboard — runs type check, tests, and lint, scores the codebase, shows trends
triggers:
  - health check
  - health
  - code quality
  - how healthy is the codebase
  - run all checks
  - quality score
  - codebase health
---

Run a code quality dashboard. Report only — do not fix anything.

**Step 1: Auto-detect tooling**

Check which tools are available for this project:
```bash
test -f package.json && echo "node project"
test -f tsconfig.json && echo "typescript"
cat package.json 2>/dev/null | grep -E '"test"|"lint"|"typecheck"' | head -10
```

**Step 2: Run checks**

Run each available check and capture exit code + output:

1. **Tests** — `npm test` or equivalent. Record: pass/fail, test count, any failures.
2. **Type check** — `npx tsc --noEmit` if TypeScript. Record: error count.
3. **Lint** — if eslint/biome configured, run it. Record: warning/error count.
4. **Dead code** — `npx knip` if available, otherwise skip.

**Step 3: Score**

Score on a 0–10 scale using this rubric:
- Tests: 40% weight (10 = all pass, 0 = none or failing)
- Type check: 25% weight (10 = zero errors)
- Lint: 20% weight (10 = zero warnings)
- Dead code: 15% weight (10 = no unused exports)

If a tool isn't available, redistribute its weight proportionally.

**Step 4: Report**

```
HEALTH SCORE: X.X / 10

| Check      | Result       | Score |
|------------|-------------|-------|
| Tests      | 139/139 pass | 10/10 |
| Type check | 0 errors     | 10/10 |
| Lint       | not configured| —    |
| Dead code  | not available | —    |
```

Add a one-paragraph interpretation: what does the score tell you? What's the weakest area?

**Step 5: Persist**

Append the score to `.phase2s/health/history.jsonl`:
```json
{"date":"YYYY-MM-DD","score":9.2,"tests":"pass","typecheck":"pass","lint":"skip","notes":""}
```

If 3+ prior entries exist, show the trend (improving / stable / declining).
