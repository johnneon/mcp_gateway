# Design

## Context

See `proposal.md` — Why. Today the tracker skill always launches `set-status.ps1` and `set-iteration.ps1`. Those scripts are the source of truth for project `2` / owner `johnneon` / repo `johnneon/mcp_gateway`, Status options, Iteration GraphQL selection, and failure messages. This machine has `gh` but neither `powershell` nor `pwsh`. The person already accepted: keep the `.ps1` files for Windows, add bash twins, prefer PowerShell when present, use temp body files on POSIX. Do not reopen that design.

Gateway product specs and `mcp-gateway-spec.md` are out of scope; this change only touches agent skills and scripts under `.cursor/skills/`.

## Goals / Non-Goals

**Goals:**

- Bash 3.2-compatible `set-status.sh` and `set-iteration.sh` that match the `.ps1` arguments, failure behavior, and success prints.
- Tracker skill launcher: PowerShell when available, bash otherwise; no macOS PowerShell install instruction.
- POSIX body-file guidance in `tracker` and `commits` skills; Windows here-string unchanged.
- Automated tests for the delta scenarios with a fake `gh` (and file reads), without a live Projects API as the primary assertion.

**Non-Goals (design level):**

- Rewriting or deleting the `.ps1` scripts.
- Changing Priority, Size, card order, or Done-by-hand flows.
- Any gateway runtime, `server/`, `web/`, or MCP change.

## Decisions

### 1. Bash twins next to the PowerShell scripts

- Paths: `.cursor/skills/tracker/scripts/set-status.sh` and `set-iteration.sh`.
- Same fixed constants as the `.ps1` files: `$Owner = johnneon`, `$ProjectNumber = 2`, `$Repo = johnneon/mcp_gateway`.
- Parse JSON with `jq` and/or `gh --jq`. Prefer writing JSON to a temp file and piping to `jq` when `gh --format json` output may contain control characters that break a naive pipe — apply may use `gh … --jq` for simple fields and a temp file for item lists if needed.
- Locate `gh` with `command -v gh` only. Do not use the Windows `ProgramFiles\GitHub CLI\gh.exe` path in the bash scripts.

**Alternative:** one cross-platform Node helper — rejected; keep shell scripts next to the existing PowerShell ones so agents call the same shape of command.

### 2. set-status.sh contract (mirror set-status.ps1)

- Arguments: issue number and Status. Enforce the same five names: `Backlog`, `Ready`, `In progress`, `In review`, `Done` (ValidateSet equivalent in bash).
- Resolve: `gh project view`, `gh project field-list` (Status field + option id), `gh project item-list` (item for issue number + repo), then `gh project item-edit --single-select-option-id`.
- Fail if Status is not an option: message like `Status '<name>' is not an option of the Status field`.
- Fail if issue not on board: message like `Issue #<n> of johnneon/mcp_gateway is not on project 2`.
- Success stdout: `#<n> -> <Status>`.

### 3. set-iteration.sh calendar days (mirror set-iteration.ps1)

- Argument: issue number only.
- GraphQL query for `field(name: "Iteration")` with `configuration.iterations { id title startDate duration }`, same shape as the PowerShell payload (temp file + `gh api graphql --input`).
- Today = local calendar date `yyyy-MM-dd`.
- For each iteration: parse `startDate` as a calendar date; end = start plus `duration` calendar days (equivalent to .NET `DateTime.AddDays`, not unix seconds / 86400).
- Covering: `today >= start` and `today < end`. Among covers, keep the latest start.
- If none: fail with `No current iteration covers <yyyy-MM-dd>. Create one on the Task tracker board.`
- Success stdout: `#<n> -> <title>`.
- Bash 3.2: no associative arrays required beyond what 3.2 supports; no `mapfile` from process substitution if avoidable; prefer `while read` loops.

**Alternative:** epoch-day math — rejected; DST can shift the midnight boundary relative to calendar AddDays.

### 4. Tracker skill launcher

In `.cursor/skills/tracker/SKILL.md`:

- If `powershell` or `pwsh` is on `PATH`, keep today's commands (`powershell -NoProfile -ExecutionPolicy Bypass -File …set-status.ps1` / `set-iteration.ps1`).
- Else: `bash .cursor/skills/tracker/scripts/set-status.sh <n> "<Status>"` and `bash .cursor/skills/tracker/scripts/set-iteration.sh <n>`.
- Keep `ProgramFiles\GitHub CLI\gh.exe` only in the Windows / PowerShell path for locating `gh`.
- Do not add "install PowerShell on macOS".

### 5. POSIX body files in tracker and commits

- Document writing the body to a temp file (`mktemp`), then `gh … --body-file` or `git commit -F`, then remove the file. Heredoc into that file is fine.
- Keep the existing PowerShell `New-TemporaryFile` / here-string examples for Windows.
- Apply touches only the body-passing sections; do not rewrite unrelated skill content.

### 6. Automated tests without a live Projects API

Place tests where the repo already runs Vitest for repository contracts (same pattern as `pull-request-checks`): preferably under `server/test/` (or a small dedicated folder picked at apply).

- File-read scenarios: assert script and skill text contain the required contracts (Status names, project constants, Iteration field name, calendar-day selection language / absence of epoch-day math, launcher wording, POSIX body-file wording).
- Fake-`gh` scenarios: put a stub `gh` early on `PATH` that answers `project view`, `field-list`, `item-list`, `item-edit`, and `api graphql` with fixture JSON; spawn the bash scripts; assert exit codes, stderr messages, and success prints.
- Do not require a live call to GitHub Projects for the automated suite to pass.

## Risks / Trade-offs

- [`gh project item-list --format json` may contain unescaped control characters that break `jq`] → Mitigation: filter with `gh --jq` where possible, or write raw output to a file and parse carefully; mirror PowerShell's ConvertFrom-Json resilience as far as bash allows.
- [Bash 3.2 on macOS lacks newer bash features] → Mitigation: stick to 3.2 constructs; smoke-test scripts with `bash --version` / explicit `bash` invocation.
- [Fake `gh` stubs drift from real CLI flags] → Mitigation: stub only the subcommands the scripts call; keep fixtures next to the tests.
- [PowerShell and bash diverge over time] → Mitigation: delta scenarios and failure message strings stay aligned with the `.ps1` source; apply does not rewrite `.ps1`.

## Migration Plan

Pure addition of scripts and skill text. Rollback: revert the change's commits. No product data and no board automation change beyond what agents already do with the `.ps1` scripts.

## Open Questions

None. The person already agreed this design; apply follows the `.ps1` scripts as the behavioral reference.
