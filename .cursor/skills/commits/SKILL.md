---
name: commits
description: Owns git for an MCP Gateway change — the change branch, commits during propose, apply, and fix, the validator's report commit, push, and the pull request into main. Use whenever a change needs a branch, a commit, a push, or a pull request.
---

# Commits

Every change lives on its own branch `change/<name>`. Work never lands on `main` directly. The person merges the pull request.

## Branch

Create it at the start of propose, before writing artifacts.

1. `git status --short`. If the tree has changes that do not belong to this task, stop and ask.
2. `git fetch origin`.
3. If `change/<name>` already exists locally or on `origin`, stop and ask.
4. `git switch -c change/<name> origin/main`.

Apply and fix continue on the same branch. Before starting, `git switch change/<name>` and check `git status --short` is clean.

## When to commit

| Moment | Who | Prefix | Content |
| --- | --- | --- | --- |
| proposal written and validated | developer | `docs:` | `openspec/changes/<name>/` |
| proposal revised after review | developer | `docs:` | changed artifacts |
| a task in `tasks.md` is done and its tests pass | developer | `feat:`, `fix:`, `refactor:`, `test:`, `chore:` | code, tests, the checked task |
| verification round written | validator | `docs:` | `verification.md` and `e2e/` of this change only |
| a blocker fixed | developer | `fix:` | code and tests for that blocker |
| change archived | developer | `docs:` | archived change and updated `openspec/specs/` |

One task is one commit. Do not batch several tasks, and do not commit a task whose tests fail.

## Message

The subject after the prefix says why, not which files changed. English, imperative, no trailing period.

- `feat:` new behavior
- `fix:` a defect or a validator blocker
- `refactor:` structure only, behavior stays the same
- `test:` tests only
- `docs:` OpenSpec artifacts, verification reports, documentation
- `chore:` tooling, dependencies, configuration

The body names the change, and the task or the blocker:

```
feat: store account secrets encrypted at rest

Change: encrypted-store
Task: 1.2
```

PowerShell:

```powershell
git commit -m @"
<type>: <why>

Change: <name>
Task: <id>
"@
```

## Staging

- Inspect `git status` and `git diff` first. Stage paths explicitly: `git add <path> ...`. No `git add -A`, no `git add .`.
- The validator stages only `openspec/changes/<name>/verification.md` and `openspec/changes/<name>/e2e/`.
- Never commit `.env`, keys, the data directory, `node_modules/`, or build output.

## Push and pull request

Only after `verification.md` says `blockers: 0` and the change is archived.

1. The tree is clean and the full test suite passes.
2. `git push -u origin change/<name>`.
3. Create the pull request into `main`:

```powershell
gh pr create --base main --head change/<name> --title "<prefix>: <outcome>" --body @"
## Outcome
<one or two sentences>

## Change
openspec/changes/archive/<date>-<name>/

## Verification
blockers: 0 — see verification.md in the archived change.

## How to check
<commands to run the process and the tests>
"@
```

4. Report the pull request link to the person.

If `gh` is missing or not authenticated, push anyway and give the person the compare link `https://github.com/<owner>/<repo>/compare/main...change/<name>?expand=1`. Say that `gh` needs `gh auth login`.

After the pull request exists, further fixes go to the same branch: commit, a new validator round, push. Do not open a second pull request.

## Never

- Commit or push to `main`.
- Merge the pull request. The person merges.
- `git push --force`, `git commit --amend`, `git rebase` on a pushed branch, `--no-verify`, interactive add.
- Change git config.
