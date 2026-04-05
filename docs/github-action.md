# GitHub Action

Phase2S runs as a GitHub Action. This means you can have it automatically review every pull request, run a health check on every push, or audit your code on a schedule — without you remembering to ask.

If you've never used GitHub Actions: they're automated tasks that GitHub runs for you when things happen in your repo (a PR is opened, code is pushed, etc.). You describe the task in a YAML file inside `.github/workflows/`, and GitHub runs it on their servers.

---

## When is this actually useful?

**For a solo developer:** The main value is that AI review happens even when you don't think to ask. Open a PR to your own repo and get a `/review` or `/adversarial` before you merge — while you're still in "making the change" mode, not "oh I should review that" mode two days later.

**For a team:** Every PR gets the same structured review regardless of how busy the team is. The action posts its output as a PR comment, so reviewers see it alongside human comments.

**Common setups:**
- Auto-run `/adversarial` on every PR. If the skill raises a challenge, the action fails and blocks merge until you address it (or override).
- Auto-run `/review` on every PR. Output goes into the PR as a comment — advisory, doesn't block.
- Auto-run `/health` on a weekly schedule. Track code quality over time.
- Auto-run `/audit` on a weekly schedule. Catch new dependency CVEs.

---

## Quick start

Create `.github/workflows/phase2s-review.yml` in your repo:

```yaml
name: Phase2S Review

on:
  pull_request:

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: scanton/phase2s@v1
        with:
          skill: review
          provider: anthropic
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

That's it. When a PR is opened or updated, Phase2S runs `/review`, and the output appears as a PR comment.

**Setting up the secret:** Go to your repo → Settings → Secrets and variables → Actions → New repository secret. Name it `ANTHROPIC_API_KEY`, paste your key. `GITHUB_TOKEN` is provided automatically by GitHub — no setup needed.

---

## Adversarial review that can block a PR

If you want the action to actually fail (and block merge) when the adversarial skill challenges the plan:

```yaml
name: Phase2S Adversarial Review

on:
  pull_request:

jobs:
  adversarial:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: scanton/phase2s@v1
        with:
          skill: adversarial
          provider: anthropic
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          fail-on: challenged
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

When `fail-on: challenged`, the action fails if `/adversarial` emits `VERDICT: CHALLENGED`. You can then require this check to pass before merging (repo Settings → Branches → Branch protection rules).

---

## Weekly health and security audit

```yaml
name: Phase2S Weekly Audit

on:
  schedule:
    - cron: '0 9 * * 1'  # Every Monday at 9am UTC

jobs:
  health:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: scanton/phase2s@v1
        with:
          skill: health
          provider: anthropic
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}

  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: scanton/phase2s@v1
        with:
          skill: audit
          provider: anthropic
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

Results appear in the GitHub Actions tab as Step Summaries. No PR comment (no pull request event).

---

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `skill` | yes | — | Skill name, with or without leading `/` (`review`, `/adversarial`, etc.) |
| `args` | no | `""` | Additional text appended to the skill prompt (`src/auth.ts`, `"focus on security"`, etc.) |
| `provider` | no | `anthropic` | AI provider: `anthropic`, `openai-api`, or `ollama` |
| `anthropic-api-key` | no | — | Anthropic API key. Required when `provider: anthropic`. Pass as `${{ secrets.ANTHROPIC_API_KEY }}` |
| `openai-api-key` | no | — | OpenAI API key. Required when `provider: openai-api`. Pass as `${{ secrets.OPENAI_API_KEY }}` |
| `fail-on` | no | `error` | When to fail: `never`, `error` (non-zero exit), `challenged` (VERDICT: CHALLENGED or non-zero exit) |

---

## Outputs

| Output | Description |
|--------|-------------|
| `result` | Full text output from the skill |
| `verdict` | Extracted verdict if present: `APPROVED`, `CHALLENGED`, or `NEEDS_CLARIFICATION`. Only `/adversarial` emits a verdict. Empty string otherwise. |

Use outputs in downstream steps:

```yaml
- uses: scanton/phase2s@v1
  id: review
  with:
    skill: adversarial
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}

- run: echo "Verdict was ${{ steps.review.outputs.verdict }}"
```

---

## Using a specific skill on specific files

Use `args:` to target a file or give the skill extra context:

```yaml
- uses: scanton/phase2s@v1
  with:
    skill: review
    args: src/core/auth.ts
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    provider: anthropic
```

Or focus the adversarial review on a specific plan document:

```yaml
- uses: scanton/phase2s@v1
  with:
    skill: adversarial
    args: "Review the changes in this PR. Focus on security and correctness."
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    fail-on: challenged
```

---

## Using OpenAI API instead of Anthropic

```yaml
- uses: scanton/phase2s@v1
  with:
    skill: review
    provider: openai-api
    openai-api-key: ${{ secrets.OPENAI_API_KEY }}
```

---

## What gets posted where

**PR comment:** When the action runs on a `pull_request` event and `GITHUB_TOKEN` is set in `env:`, the full skill output is posted as a PR comment. Long outputs (>60,000 characters) are truncated with a link to the full output.

**Step Summary:** Every run writes a summary to the GitHub Actions Step Summary tab, visible in the Actions UI. This works on all event types (push, schedule, etc.).

**Outputs:** Available for use in downstream steps via `steps.<id>.outputs.result` and `steps.<id>.outputs.verdict`.

---

## Keeping `GITHUB_TOKEN` optional

The action works without `GITHUB_TOKEN`. Without it, no PR comment is posted. The skill still runs and results appear in the Step Summary. Useful for scheduled runs and push events where there's no PR to comment on.

```yaml
- uses: scanton/phase2s@v1
  with:
    skill: health
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
# No env: GITHUB_TOKEN — Step Summary only, no PR comment
```

---

## Version pinning

`uses: scanton/phase2s@v1` points to a floating tag that always tracks the latest `v0.x` release. This means you get bug fixes and new skills automatically.

To pin to an exact version:

```yaml
- uses: scanton/phase2s@v0.24.0
```
