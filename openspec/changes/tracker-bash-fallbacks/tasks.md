# Tasks

## 1. Bash board scripts

- [x] 1.1 Add `.cursor/skills/tracker/scripts/set-status.sh` beside `set-status.ps1`: issue number and Status (`Backlog`, `Ready`, `In progress`, `In review`, `Done`); resolve project `2`, owner `johnneon`, repo `johnneon/mcp_gateway`, Status field, and card; fail if Status is not an option or the issue is not on the board; print `#<n> -> <Status>`; bash 3.2; JSON via `jq` / `gh --jq`. Check: script exists; file-read automated test for scenario "Script documents required Status arguments" passes.

- [x] 1.2 Add `.cursor/skills/tracker/scripts/set-iteration.sh` beside `set-iteration.ps1`: issue number; GraphQL field `Iteration`; pick covering iteration by calendar days (start ≤ today < start+duration AddDays); latest start on ties; fail with a message if none covers today; print `#<n> -> <title>`; no unix-epoch day math; bash 3.2. Check: script exists; file-read automated test for scenario "Script documents calendar-day iteration selection" passes.

## 2. Skill launcher and POSIX bodies

- [x] 2.1 Update `.cursor/skills/tracker/SKILL.md`: if `powershell` or `pwsh` is on `PATH`, run the `.ps1` files; otherwise `bash .cursor/skills/tracker/scripts/set-status.sh` and `set-iteration.sh`; keep `ProgramFiles` `gh.exe` Windows-only; do not tell agents to install PowerShell on macOS; document POSIX temp/body-file for issue and comment bodies. Check: automated test for scenario "Skill documents PowerShell-first then bash fallback" passes.

- [ ] 2.2 Update `.cursor/skills/commits/SKILL.md` so a POSIX shell writes commit and pull request bodies to a temp/message file; keep the PowerShell here-string for Windows. Check: automated test for scenario "Tracker and commits skills document POSIX body files" passes.

## 3. Delta automated tests

- [ ] 3.1 Add automated tests (fake `gh` on `PATH`, no live Projects API) for set-status failure scenarios: missing board membership and unknown Status — non-zero exit and clear error messages. Check: tests pass under `npm test`; scenario names reference the requirement.

- [ ] 3.2 Add automated tests (fake `gh`) for set-iteration: no covering iteration fails with a clear message; overlapping iterations pick the latest start and print `#<n> -> <title>`. Check: those tests pass; full root `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`, and `npm run build` exit 0.
