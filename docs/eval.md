# Eval Framework

Phase2S has an end-to-end eval framework that runs skills against scripted prompts,
scores the output with an LLM judge, and writes results to `~/.gstack-dev/evals/` in
the format the `land-and-deploy` readiness gate expects.

## Running evals

```bash
npm run eval
```

Output:

```
Running eval suite (3 cases)...

✓ adversarial-basic-plan-challenge   8.5/10  (1.2s)
✓ review-basic-diff-coverage         7.0/10  (0.9s)
✓ satori-typescript-function         9.0/10  (14.3s)

Results: 3 passed, 0 failed
Scores:  adversarial=8.5  review=7.0  satori=9.0
Written: ~/.gstack-dev/evals/ (6 files)

✔ Deploy gate: READY
```

When multiple eval cases share the same skill, the score summary shows the range:

```
Scores:  adversarial=7-9  review=7.0
```

If any score is below 6.0, the command exits with code 1 and the deploy gate is blocked.

## Adding eval cases for a new skill

Create a YAML file at `eval/<skill-name>.eval.yaml`:

```yaml
name: <skill>-<what-it-tests>        # unique case name, used in output
skill: <skill-name>                   # must match a loaded skill's name field
inputs:
  plan: |                             # map to the skill's declared inputs ({{key}} placeholders)
    Your input text here.
acceptance_criteria:
  - text: Response contains VERDICT field
    type: structural                  # deterministic regex check — no LLM call
    match: "VERDICT:"                 # regex pattern (case-insensitive)
  - text: Identifies a concrete failure mode
    type: quality                     # LLM-judged criterion
timeout_ms: 60000                     # optional, default 60s
```

### Fixture-based eval cases (for skills that write files)

Skills like `/satori` need a real project directory to operate in. Use `fixture:` to scaffold a
temporary project before the run and tear it down unconditionally after:

```yaml
name: satori-add-function
skill: satori
timeout_ms: 120000
fixture:
  type: node-project                  # bare-dir also available (no package.json pre-created)
  files:
    - path: package.json
      content: |
        {"name":"eval-fixture","version":"1.0.0","scripts":{"test":"npm test"}}
    - path: src/add.ts
      content: |
        // TODO: implement add(a: number, b: number): number
inputs:
  task: "Implement the add() function in src/add.ts so it returns a+b."
  eval_command: "npm test"            # passed to the satori retry loop as verifyCommand
verify_files:
  - src/add.ts                        # checked for existence after the run
acceptance_criteria:
  - text: Output mentions the file was modified
    type: structural
    match: "add\\.ts|modified|wrote"
  - text: The implementation is correct
    type: quality
```

**How it works:**
- `fixture.files` are written to a `mkdtemp`-backed temp directory before the run.
- The agent's working directory is set to that temp dir — file and shell tools operate there.
- The temp directory is removed unconditionally after the run (even on agent error).
- `verify_files` asserts that the listed paths exist in the fixture directory after the run. Fails with an error if any path is missing.
- `eval_command` in `inputs` is picked up by the runner and passed to the satori retry loop (`maxRetries: skill.retries`, `verifyCommand: eval_command`). Skills without `retries > 0` ignore this field.

Path traversal is blocked in both `fixture.files` and `verify_files`: paths like `../../etc/passwd` are rejected.

### Criterion types

| Type | How evaluated | When to use |
|------|---------------|-------------|
| `structural` | Regex match against output (deterministic, instant) | Checking for required section headers, field names, format markers |
| `quality` | LLM judge evaluates against the criterion text | Checking content quality, completeness, actionability |

If `type` is omitted, it defaults to `quality`.

A `structural` criterion without a `match` field also falls back to `quality`.

### Finding your skill's input keys

Look at the skill's SKILL.md frontmatter:

```markdown
---
name: adversarial
inputs:
  plan:
    prompt: "The plan to challenge"
---
{{plan}}
```

The keys under `inputs:` in the frontmatter map to `{{key}}` placeholders in the
template. Use those same keys in your eval case's `inputs:` field.

### Acceptance criteria guidelines

- **Structural criteria first**: put `type: structural` criteria before quality ones.
  They are checked instantly and provide fast signal.
- **Be specific**: "Response identifies state loss as a failure mode" is better than
  "Response is good".
- **One criterion per concern**: don't combine multiple checks in one criterion.
- **3–6 criteria per case**: enough to verify quality, not so many that partial scores
  are always low.

### Score formula

```
score = (met × 1.0 + partial × 0.5) / total × 10
```

A score ≥ 6.0 passes the gate. Below 6.0 blocks the deploy.

## Output files

Two files are written per eval case to `~/.gstack-dev/evals/`:

| Pattern | Contents |
|---------|----------|
| `{skill}-e2e-run-{date}-{ts}.json` | Raw runner result: inputs, output, elapsed_ms |
| `{skill}-llm-judge-run-{date}-{ts}.json` | Judge result: score, verdict, criteria coverage |

These match the globs the `land-and-deploy` gate checks:
- `*-e2e-*-{date}*.json`
- `*-llm-judge-*-{date}*.json`

## Architecture

```
eval/
  adversarial.eval.yaml    ← eval case definitions
  review.eval.yaml
  satori.eval.yaml         ← fixture-based eval (scaffolds a temp node project)

src/eval/
  runner.ts     ← loads YAML, substitutes inputs, calls agent.run(); manages fixtures
  judge.ts      ← hybrid structural/quality evaluation
  reporter.ts   ← writes JSON output files
  cli.ts        ← npm run eval entrypoint; scoresBySkill range aggregation
  types.ts      ← EvalCase, EvalFixture, RunnerResult, CriterionSpec
```

The runner calls `loadAllSkills().find()` to locate the skill, then
`substituteInputs()` to fill `{{key}}` placeholders, then `agent.run()` with the
substituted template — mirroring exactly how the REPL invokes skills.

For fixture-based cases, `setupFixture()` creates the temp directory before `agent.run()`,
and `teardownFixture()` removes it in a `finally` block — so cleanup runs even if the agent
throws. The Agent is constructed with `{ cwd: tmpDir }`, which threads through to all tool
sandbox checks, ensuring file reads/writes happen inside the fixture rather than the project root.
