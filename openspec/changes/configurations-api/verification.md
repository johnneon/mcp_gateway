# configurations-api

## Result
blockers: 0

## Spec
- Configurations document shape: met
- Bearer token generation and hash persistence: met
- Create configuration: met
- List configurations without secrets: met
- Enable or disable a configuration: met
- Delete a configuration: met
- Rotate returns a new token once: met
- /api mutations require application/json Content-Type: met
- No CORS headers on /api responses: met
- Token absent from plaintext on disk after create: met
- MCP port stays unchanged: met

## Checks
- tests: passed — 84 server + 2 web tests
- type check: passed
- lint: passed
- format check: passed
- build: passed

## Review
- note: `.prettierrc.json` adds `endOfLine: "auto"` (tooling; not a delta product behavior)
- note: configurations service `replace({ configurations })` writes only that key, matching design document shape

## E2E
- Empty document reads as an empty list: passed — GET `/api/configurations` → 200 `[]`
- Successful create / token once: passed — 201 with `id`, `name`, `enabled`, `token`; no `tokenHash`
- List omits token and hash: passed — list body had neither create token nor `tokenHash`
- Rotate replaces the hash immediately: passed — 200 with a new `token`
- Disable then enable: passed — PATCH `enabled` false then true
- Empty name is rejected: passed — 400
- Unknown id on PATCH — 404: passed — 404 body `Not Found`
- Form body create rejected: passed — 415
- charset=utf-8 JSON accepted: passed — 201 name `Charset`
- No CORS on successful list: passed
- Create token not in state.bin plaintext: passed
- Successful delete: passed — 204; id absent from list
- GET /mcp remains 501: passed — MCP port body `Not Implemented`
- Admin API absent on MCP port: passed — `/api/configurations` not served as 200
- Admin /mcp stays 404: passed
- Configurations screen: skipped — no admin UI for configurations in this change; admin root still shows heading "MCP Gateway" and "Admin shell"

## Leaks
- admin API create/list JSON: clean — no encryption key; list has no token or `tokenHash`
- MCP `/mcp` error body: clean
- admin UI DOM (shell smoke): clean — no `tokenHash`, no bearer-like string in inputs
- state.bin after create/rotate: clean — plaintext token bytes absent
