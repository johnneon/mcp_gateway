---
name: commits
description: Writes an MCP Gateway change commit after a validator report with no blockers. Use when the user asks to commit. Do not commit without an explicit request.
---

# Commits

Commit only when the person asks directly.

Before committing, read `.harness/reports/<change>.md`. If the file is missing or the blocker count is not zero, stop and say why. This skill does not archive the change.

## Message

One or two sentences on why the change exists, not a file list. The first line includes the change name.

Do not commit `.env`, keys, SQLite dumps, or `node_modules/`.

## Commands

In parallel, inspect `git status`, `git diff`, and `git log -5`. Then stage the relevant files and commit.

PowerShell:

```powershell
git commit -m @"
<change>: <why>

"@
```

Do not change git config. Do not use `git commit --amend`, `--no-verify`, or an interactive add.
