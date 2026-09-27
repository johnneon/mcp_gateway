---
name: tracker
description: Owns the GitHub issue behind an MCP Gateway change and its card on the Task tracker project board — reading or creating the issue, naming the change, moving the card through the cycle, and linking the pull request so merge closes the issue. Use when a task arrives as an issue link or number, when a task arrives without an issue, and at the propose and finish steps.
---

# Tracker

Every change starts from one issue on the project board. One issue is one change, one branch `change/<name>`, and one pull request.

| What | Value |
| --- | --- |
| Board | [Task tracker](https://github.com/users/johnneon/projects/2), owner `johnneon`, number `2` |
| Repository | `johnneon/mcp_gateway` |
| Status | Backlog, Ready, In progress, In review, Done |

`gh` needs the `project` scope; `gh auth status` shows it. If `gh` is not on `PATH`, call `& "$env:ProgramFiles\GitHub CLI\gh.exe"`.

Windows PowerShell breaks native arguments that contain double quotes. Parse `--format json` output with `ConvertFrom-Json` instead of `--jq` filters with quotes. Pass every issue, comment, and pull request body through a file:

```powershell
$bodyFile = New-TemporaryFile
[IO.File]::WriteAllText($bodyFile, @"
<body>
"@)
gh <command> --body-file $bodyFile
Remove-Item $bodyFile
```

## Status by step

| Step | Who | Tracker action | Status after |
| --- | --- | --- | --- |
| 0. task | main agent | read the issue, or create it | unchanged |
| 1. propose | developer | right after the branch exists | In progress |
| 1. propose | developer | after the artifacts commit, comment on the issue | In progress |
| 2–5. review, apply, verify, fix | — | nothing | In progress |
| 6. finish | developer | `Closes #<n>` in the pull request body, then move the card | In review |
| fixes after pull request review | developer | nothing | In review |
| 7. merge | GitHub | the pull request closes the issue, the board moves the card | Done |

If the person drops the change, move the card to Backlog and say so. Do not close the issue.

The validator does not touch the tracker.

## Read the issue

Accept a full URL, `#<n>`, or `<n>`.

```powershell
gh issue view <n> --repo johnneon/mcp_gateway --json number,title,body,state,projectItems
```

- Closed issue, or a card already in In review or Done: stop and ask.
- The issue is not on the board: add it with `gh project item-add 2 --owner johnneon --url <issue url>`.
- The body is the task. Unclear outcome: ask the person before propose, as in step 0 of `docs/workflow.md`.

## Create the issue

When a task arrives without an issue, create one before propose, from the person's words. Title is the change name. Body in English: outcome, what is included, how it is checked.

```powershell
gh issue create --repo johnneon/mcp_gateway --title "<name>" --assignee "@me" --project "Task tracker" --body-file $bodyFile
```

Body:

```markdown
**What / where**: <outcome>

**Todo**:

- <item>

**Verification**: <check>
```

Then move the card to Backlog with `set-status.ps1 -Status "Backlog"`, set Iteration to the current iteration, and report the issue link to the person.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .cursor/skills/tracker/scripts/set-iteration.ps1 -Issue <n>
```

The script selects the iteration whose start date is today or earlier and whose end (start plus duration in days) is after today. If no iteration covers today, it fails with a message. Report that failure to the person. It does not undo the issue.

## Change name

Kebab-case, the same string for the change, the branch, and the commit body.

- Title `NN. <kebab-name>`: drop the number, `03. encrypted-store` gives `encrypted-store`.
- Any other title: derive a short kebab-case name from the outcome and tell the person.

## Move the card

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .cursor/skills/tracker/scripts/set-status.ps1 -Issue <n> -Status "In progress"
```

The script resolves the project, the Status field, and the card by name, and fails with a message if the issue is not on the board. A failure to move the card is reported to the person; it does not undo the git step.

At finish, the board workflow `Pull request linked to issue` also sets a status a few seconds after the pull request opens. Move the card after `gh pr create` returns, wait about 30 seconds, and read the status again with `gh issue view <n> --json projectItems`. If it is not In review, move it once more and tell the person the workflow must target In review, as `docs/workflow.md` lists.

## Link the change to the issue

- `openspec/changes/<name>/proposal.md` has the line `Issue: #<n>` right under `# Proposal`. Later modes read the number from there, also after archive.
- Commit bodies carry `Issue: #<n>` under `Change:`, per `commits`.
- The pull request body has `Closes #<n>`, per `commits`. Without it, merge does not close the issue and the card stays in In review.

## Comment on the issue

Once, after the propose commit:

```powershell
gh issue comment <n> --repo johnneon/mcp_gateway --body-file $bodyFile
```

Body:

```markdown
Proposal `<name>`: `openspec/changes/<name>/` on branch `change/<name>`, pushed at finish.

<outcome and non-goals in two or three sentences>
```

No other comments. The pull request link appears on the issue by itself.

## Never

- Close an issue or move a card to Done by hand. Merge does it.
- Edit Priority, Size, or order. Those belong to the person.
- Change Iteration except when creating an issue, and then only to the current iteration.
- Put a secret, a bearer, or a key in an issue, a comment, or a card.
