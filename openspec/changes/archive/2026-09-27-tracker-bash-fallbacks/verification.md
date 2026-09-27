# tracker-bash-fallbacks

## Result
blockers: 0

## Spec
- set-status.sh moves a card or fails clearly: met
- set-iteration.sh selects the current iteration by calendar days: met
- Tracker skill prefers PowerShell and falls back to bash: met
- POSIX shells write bodies through a temp file: met

## Checks
- tests: passed — 92 server + 2 web; all tracker delta scenarios covered (file-read and fake-gh)
- type check: passed
- lint: passed
- format check: passed
- build: passed

## Review
- note: Unknown Status is rejected by the bash `case` ValidateSet equivalent before `gh project field-list` runs; behavior and error text still match the delta and the `.ps1` contract
- note: change is skills/scripts/tests only; no `server/src` or `web` product surface in the delta

## E2E
- Script documents required Status arguments: n/a — agent script contract; not visible to admin UI or MCP client (covered by automated file-read test)
- Missing board membership fails with a clear message: n/a — agent script; covered by fake-gh automated test
- Unknown Status fails with a clear message: n/a — agent script; covered by fake-gh automated test
- Script documents calendar-day iteration selection: n/a — agent script contract; covered by automated file-read test
- No covering iteration fails with a clear message: n/a — agent script; covered by fake-gh automated test
- Overlapping iterations pick the latest start: n/a — agent script; covered by fake-gh automated test
- Skill documents PowerShell-first then bash fallback: n/a — skill markdown; not an operator or MCP walk
- Tracker and commits skills document POSIX body files: n/a — skill markdown; not an operator or MCP walk
- Playwright MCP: available (user-playwright tools listed); no admin UI walk invented because the delta has no operator-visible surface
- MCP HTTP client: not applicable — delta does not change MCP tools, ports, or configurations

## Leaks
- git diff origin/main...HEAD (scripts, skills, tests, openspec change): clean
- fake-gh fixtures and script constants (owner/repo/project only): clean
- mcp-gateway-spec.md / openspec/specs/: untouched
