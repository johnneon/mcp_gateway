# Proposal

Issue: #31

## Why

Agents on macOS and Linux follow the tracker skill by launching `set-status.ps1` and `set-iteration.ps1`, but this machine has no PowerShell. Card moves fail even though `gh` is installed and authenticated. Bash fallbacks next to the existing scripts close that gap without changing how Windows agents work.

## What Changes

- Add `.cursor/skills/tracker/scripts/set-status.sh` and `set-iteration.sh` beside the existing `.ps1` scripts, with the same arguments, the same failure behavior, and the same board effect.
- Update `.cursor/skills/tracker/SKILL.md` so that when `powershell` or `pwsh` is on `PATH`, agents keep running the `.ps1` files; otherwise they run the bash scripts. The `ProgramFiles` path to `gh.exe` stays Windows-only.
- On a POSIX shell, `tracker` and `commits` skills write issue, comment, commit, and pull request bodies to a temp file (heredoc or message file). The PowerShell here-string stays the Windows path. Agents are not told to install PowerShell on macOS.

This change does not alter gateway product behavior: no edits to the process, `server/`, `web/`, MCP, or `mcp-gateway-spec.md`.

## Non-goals

- Do not delete or rewrite the `.ps1` scripts.
- Do not install PowerShell.
- Do not change the gateway process, `server/`, `web/`, MCP, or `mcp-gateway-spec.md`.
- Do not change Priority, Size, or card order.
- Do not close issues or move cards to Done by hand.

## Capabilities

### New Capabilities

- `tracker-board-scripts`: repository contract for Task tracker card moves — bash `set-status` / `set-iteration` scripts (arguments, calendar-day iteration selection, failure messages, success prints), the tracker skill launcher (PowerShell when available, bash otherwise), and POSIX body-file usage in the tracker and commits skills.

### Modified Capabilities

- (none — product specs under `openspec/specs/` are unchanged; gateway runtime behavior stays the same)

## Impact

- New files under `.cursor/skills/tracker/scripts/` (`set-status.sh`, `set-iteration.sh`).
- Edits to `.cursor/skills/tracker/SKILL.md` and `.cursor/skills/commits/SKILL.md` only for launcher choice and POSIX body files.
- Automated checks that cover the delta scenarios without calling the live GitHub Projects API as the primary assertion (script structure, skill text, and calendar-day selection logic).
- No impact on `server/`, `web/`, encrypted store, MCP ports, or connectors.
