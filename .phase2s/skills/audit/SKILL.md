---
name: audit
description: Security audit — scans for secrets, injection risks, dependency vulnerabilities, and file access controls
model: smart
triggers:
  - security audit
  - audit
  - security review
  - vulnerability scan
  - run security
  - threat model
  - pentest review
  - check for vulnerabilities
inputs:
  scope:
    prompt: "Which directory to audit? (leave blank to scan the entire project)"
---

Run a multi-phase security audit. If `{{scope}}` is provided, restrict scanning to that directory. Otherwise, scan the entire project. For each finding, report: severity (CRIT/HIGH/MED/LOW), confidence (VERIFIED/UNVERIFIED), and a concrete exploit scenario. Do not fix — report only.

## Phase 1: Secrets in Code

Search for hardcoded credentials and tokens:
```bash
grep -rn "sk-\|api_key\|apikey\|secret\|password\|token\|AWS_\|GITHUB_TOKEN" --include="*.ts" --include="*.js" --include="*.env" --include="*.yaml" --include="*.json" . | grep -v "node_modules\|\.git\|test\|spec\|example"
```

Also check git history for secrets that may have been committed and removed:
```bash
git log --all --oneline | head -50
git log --all -p --follow -S "password\|secret\|api_key" -- . | grep "^+" | grep -iv "test\|example\|readme" | head -20
```

## Phase 2: Input Validation and Injection

Review all places where user-supplied input reaches:
- Shell commands (shell.ts — any unsanitized interpolation?)
- File paths (are all paths validated through assertInSandbox?)
- LLM prompts (can user input manipulate system prompt behavior?)

Flag any path that takes external input → system call without validation.

## Phase 3: Dependency Vulnerabilities

```bash
npm audit --audit-level=moderate 2>/dev/null | head -40
```

Report any high/critical findings. Note any dependencies that are pinned vs. floating.

## Phase 4: File Access Controls

- Are file reads and writes sandboxed to project directory? (Check file-read.ts, file-write.ts)
- Does the sandbox use `realpath()` or just `path.resolve()`?
- Can symlinks inside the project point to paths outside? (check sandbox.ts)
- Are session files readable only by the owner? (check file permissions on `.phase2s/sessions/`)

## Phase 5: Shell Command Safety

- What destructive commands are blocked by default? (check shell.ts allowDestructive list)
- Is the blocklist comprehensive? Name 3 dangerous commands not on the list.
- Can a crafted prompt bypass the blocklist via argument injection?

## Phase 6: Session and Persistence Security

- Are session files validated on load? (role validation, message structure)
- Can a crafted session file inject arbitrary messages with model-trusted roles?
- Is there a size cap on session files loaded via `--resume`?

---

## Final Report

Summarize all findings in a table:

| # | Severity | Phase | Finding | Confidence |
|---|----------|-------|---------|------------|
| 1 | CRIT | 1 | ... | VERIFIED |

End with overall risk verdict:
- **CLEAN** — no significant issues
- **LOW RISK** — minor issues, no immediate action required
- **MEDIUM RISK** — issues that should be addressed in next sprint
- **HIGH RISK** — issues that should be fixed before next release

Use the `shell` tool to get the current datetime (`date +%Y-%m-%d-%H%M`), then save the report to `.phase2s/security-reports/<datetime>.md`. Create the directory first: `mkdir -p .phase2s/security-reports/`.
