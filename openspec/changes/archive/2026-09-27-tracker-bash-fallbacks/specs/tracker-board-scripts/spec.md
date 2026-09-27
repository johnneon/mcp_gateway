# Spec Delta

## Purpose

Defines the repository contract for moving Task tracker cards from agent skills: bash fallbacks for Status and Iteration on macOS and Linux, PowerShell preference when available, and POSIX body files for issue and git bodies — without changing gateway product behavior.

## ADDED Requirements

### Requirement: set-status.sh moves a card or fails clearly

The repository SHALL contain `.cursor/skills/tracker/scripts/set-status.sh` that accepts an issue number and a Status of exactly one of `Backlog`, `Ready`, `In progress`, `In review`, or `Done`. The script SHALL resolve project number `2`, owner `johnneon`, repository `johnneon/mcp_gateway`, the Status field, and the card for that issue. It SHALL fail (non-zero exit) if the Status is not an option of the Status field or if the issue is not on the board. On success it SHALL print `#<n> -> <Status>` where `<n>` is the issue number and `<Status>` is the requested status name.

#### Scenario: Script documents required Status arguments

- **GIVEN** the repository contains `.cursor/skills/tracker/scripts/set-status.sh`
- **WHEN** a test reads that script (without calling the GitHub API)
- **THEN** the script text accepts an issue number argument and a Status argument
- **AND** the allowed Status values include `Backlog`, `Ready`, `In progress`, `In review`, and `Done`
- **AND** the script text resolves project `2`, owner `johnneon`, and repository `johnneon/mcp_gateway`
- **AND** the success print format `#` issue `->` Status appears in the script

#### Scenario: Missing board membership fails with a clear message

- **GIVEN** a fake `gh` on `PATH` that returns project and Status field data but no item for issue `99999` of `johnneon/mcp_gateway`
- **WHEN** `bash .cursor/skills/tracker/scripts/set-status.sh` runs with issue `99999` and Status `In progress`
- **THEN** the exit code is non-zero
- **AND** the error output states that the issue is not on the project

#### Scenario: Unknown Status fails with a clear message

- **GIVEN** a fake `gh` on `PATH` that returns the Status field options for project `2`
- **WHEN** `bash .cursor/skills/tracker/scripts/set-status.sh` runs with a valid on-board issue number and Status `NotAStatus`
- **THEN** the exit code is non-zero
- **AND** the error output states that the Status is not an option of the Status field

### Requirement: set-iteration.sh selects the current iteration by calendar days

The repository SHALL contain `.cursor/skills/tracker/scripts/set-iteration.sh` that accepts an issue number. It SHALL read the GraphQL field named `Iteration` on project `2` (owner `johnneon`). It SHALL pick the iteration whose start date is today or earlier and whose end (start date plus duration in calendar days, matching `DateTime.AddDays`) is after today. If several iterations match, it SHALL pick the one with the latest start date. It SHALL fail with a message if none covers today. On success it SHALL print `#<n> -> <title>` where `<title>` is the chosen iteration title. Date comparison SHALL use calendar dates, not unix-epoch day arithmetic, so DST does not move the boundary. The script SHALL be compatible with bash 3.2 and SHALL parse JSON with `jq` and/or `gh --jq`.

#### Scenario: Script documents calendar-day iteration selection

- **GIVEN** the repository contains `.cursor/skills/tracker/scripts/set-iteration.sh`
- **WHEN** a test reads that script (without calling the GitHub API)
- **THEN** the script text queries the GraphQL field named `Iteration`
- **AND** the script compares start date and start-plus-duration using calendar dates (not unix-epoch day math)
- **AND** when several iterations cover today, the script prefers the latest start
- **AND** the success print format `#` issue `->` title appears in the script

#### Scenario: No covering iteration fails with a clear message

- **GIVEN** a fake `gh` on `PATH` that returns Iteration configuration where every iteration's calendar range excludes today's date
- **WHEN** `bash .cursor/skills/tracker/scripts/set-iteration.sh` runs with a valid on-board issue number
- **THEN** the exit code is non-zero
- **AND** the error output states that no current iteration covers today

#### Scenario: Overlapping iterations pick the latest start

- **GIVEN** a fake `gh` on `PATH` that returns two iterations whose calendar ranges both cover today, with different start dates
- **WHEN** `bash .cursor/skills/tracker/scripts/set-iteration.sh` runs with a valid on-board issue number
- **THEN** the exit code is zero
- **AND** stdout contains `#` issue `->` and the title of the iteration with the later start date

### Requirement: Tracker skill prefers PowerShell and falls back to bash

The tracker skill at `.cursor/skills/tracker/SKILL.md` SHALL instruct agents: if `powershell` or `pwsh` is on `PATH`, run the existing `.ps1` scripts; otherwise run `bash .cursor/skills/tracker/scripts/set-status.sh` and `bash .cursor/skills/tracker/scripts/set-iteration.sh`. The skill SHALL keep the `ProgramFiles` path to `gh.exe` as Windows-only. The skill SHALL NOT tell agents to install PowerShell on macOS.

#### Scenario: Skill documents PowerShell-first then bash fallback

- **GIVEN** the repository contains `.cursor/skills/tracker/SKILL.md`
- **WHEN** a test reads that skill file
- **THEN** the text says to run the `.ps1` scripts when `powershell` or `pwsh` is on `PATH`
- **AND** the text says to run the bash `set-status.sh` and `set-iteration.sh` otherwise
- **AND** the `ProgramFiles` path to `gh.exe` appears only as a Windows fallback for locating `gh`
- **AND** the skill does not instruct agents to install PowerShell on macOS

### Requirement: POSIX shells write bodies through a temp file

On a POSIX shell, the tracker and commits skills SHALL instruct agents to write issue, comment, commit, and pull request bodies to a temp file (or an equivalent message file / heredoc passed as a file), not via an inline PowerShell here-string. The PowerShell here-string path SHALL remain documented for Windows.

#### Scenario: Tracker and commits skills document POSIX body files

- **GIVEN** the repository contains `.cursor/skills/tracker/SKILL.md` and `.cursor/skills/commits/SKILL.md`
- **WHEN** a test reads both skill files
- **THEN** each file documents a POSIX path that writes bodies to a temp or message file for `gh` / `git` commands that need a body
- **AND** each file still documents the PowerShell here-string (or `New-TemporaryFile`) path for Windows
