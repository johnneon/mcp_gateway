# admin-configurations-ui

## Result
blockers: 0

## Spec
- Admin shell with Configurations and Connectors: met
- List configurations without tokens: met
- Create configuration and reveal token once: met
- Confirm before rotate and delete: met
- Enable or disable from the Configurations screen: met
- Show English errors from failed API calls: met
- Connectors empty state: met

## Checks
- tests: passed — server 100, web 21; tracker fake-gh tests passed via `.ps1` on Windows without bash or jq
- type check: passed
- lint: passed
- format check: passed
- build: passed

## Review
- note: admin root logs a favicon.ico 404 in the browser console; unrelated to the Configurations UI delta
- note: `listConfigurations` trusts the API shape and does not strip unexpected extra fields at runtime; list rendering only shows `name` / `enabled`, and the live list API omits token fields
- note: stack-line edits to `mcp-gateway-spec.md`, `AGENTS.md`, and `README.md` match the accepted proposal; `openspec/specs/` unchanged

## E2E
- Shell shows both navigation items and no login: passed — heading "MCP Gateway", nav "Configurations" and "Connectors", no login form
- Switching screens does not use a client router: passed — Connectors visible, URL stayed `http://127.0.0.1:50928/`
- Empty list: passed — "No configurations yet. Create one to get a bearer token."
- List shows name and enabled without secrets: passed — after create, list showed "Primary" / "Enabled"; plaintext token only in the reveal dialog
- Create shows the token in the reveal dialog: passed — dialog "Bearer token" showed a one-time token
- Token is gone after the reveal dialog closes: passed — token absent from DOM and inputs after Close
- Rotate requires confirmation then shows the new token: passed — "Rotate token?" then reveal; token cleared after Close
- Rotate without confirmation does not call the API: passed — Cancel; no rotate POST in network log for that dismiss
- Delete requires confirmation then removes the row: passed — Confirm delete returned empty state without "Primary"
- Delete without confirmation does not call the API: passed — Cancel left "Primary" listed; no DELETE until confirm
- Disable a configuration: passed — checkbox toggled label to "Disabled"; PATCH observed
- List error is shown in English: passed — covered by `ConfigurationsPage.test.tsx` (live 500 not forced in browser)
- Connectors shows empty state without API calls: passed — empty copy visible; opening Connectors did not add configuration API traffic
- MCP port separation and bearer rejection: passed — MCP `/api/configurations` 404; admin `/mcp` 404; empty and unknown bearer both 401; valid bearer `tools/list` succeeded with empty tools list; token absent from list JSON and MCP response

## Leaks
- admin UI DOM / inputs after reveal close: clean
- admin `GET /api/configurations` JSON: clean
- browser console (aside from favicon 404): clean
- MCP client tools/list body and empty/unknown bearer errors: clean
