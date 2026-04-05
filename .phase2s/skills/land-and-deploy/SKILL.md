---
name: land-and-deploy
description: Push, open a PR, merge it, wait for CI, and verify the deploy landed cleanly
model: smart
triggers:
  - land this
  - land and deploy
  - merge and deploy
  - push and merge
  - deploy this
  - merge the PR
  - land it
  - ship to production
  - push and open PR
---

You are landing code to production. This picks up where `/ship` (commit) leaves off.

**Prerequisites:** `gh` CLI must be installed and authenticated (`gh auth status`). If not available, tell the user and stop.

**Process:**

1. **Check current state.**
   - Run `git status` to confirm there are no uncommitted changes. If there are, tell the user to run `/ship` first.
   - Run `git branch --show-current` to get the current branch name.
   - If on `main` or `master`, warn the user that landing from the default branch directly is unusual. Confirm before proceeding.

2. **Push the branch.**
   - Run `git push -u origin <branch>` (use `-u` to set upstream if not already set).
   - If push fails, read the error carefully. A "non-fast-forward" error means the remote branch has diverged — tell the user they need to rebase or merge first. Do not force-push without explicit instruction.

3. **Create or find the PR.**
   - Run `gh pr view --json number,url,state 2>/dev/null` to check if a PR already exists for this branch.
   - If a PR already exists and is open, use it. Show the PR URL.
   - If no PR exists, create one:
     ```
     gh pr create --fill
     ```
     `--fill` uses the branch name and commit messages to populate the title and body. If the user provided a task description as input to this skill, use it as the PR title with `--title "..."`.
   - Show the PR URL after creation.

4. **Wait for CI checks to pass.**
   - Run `gh pr checks --watch` to stream CI status in real time.
   - If all checks pass, continue.
   - If any check fails: show which check failed and what the failure output was (run `gh run view <run-id> --log-failed` to get failure details). Tell the user to fix the failure and re-run `/land-and-deploy`. Stop here.
   - If there are no CI checks configured, note this and continue.

5. **Merge the PR.**
   - Run `gh pr merge --merge --delete-branch` to merge with a merge commit and delete the remote branch after merge.
   - If you prefer squash merge, the user can specify: `gh pr merge --squash --delete-branch`.
   - If the merge fails due to conflicts, tell the user: the branch has conflicts with the base branch. They need to resolve conflicts locally and push again.

6. **Confirm the land.**
   - Run `git fetch origin` and `git log origin/main..HEAD --oneline 2>/dev/null || git log origin/master..HEAD --oneline 2>/dev/null` to confirm the current branch's commits are now on the default branch.
   - Show the merged commit hash.
   - Optionally run `git checkout main && git pull` (or `master`) to bring the local default branch up to date.

7. **Post-merge summary.**
   Show a clean summary:
   ```
   Landed: feat/my-feature → main
   PR: #42 (https://github.com/owner/repo/pull/42)
   Merged: abc1234
   CI: all checks passed
   Branch deleted: origin/feat/my-feature
   ```

**If the user has a deploy process** (e.g., a deploy script, a deploy hook that fires on merge, or a platform like Railway/Vercel/Fly), mention that they should verify their deployment separately. Phase2S does not have visibility into post-merge deployment pipelines unless the user adds a deploy step to their project's verify command.

**Stop and report cleanly at each failure point.** Do not attempt to recover from ambiguous situations automatically.
