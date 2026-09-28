# accounts-api

## Result
blockers: 0

## Spec
- Accounts document shape: met
- List accounts without secret values: met
- Create account after connection check: met
- Patch account with secret keep semantics: met
- Check connection without write: met
- Delete account removes it from configurations: met
- Assign accounts to a configuration: met
- Accounts API follows admin JSON and CORS rules: met
- Configurations document shape (accountIds): met
- Bearer token generation and hash persistence (accountIds on create/rotate): met
- Create configuration (accountIds: []): met
- List configurations without secrets (accountIds): met
- Enable or disable a configuration (accountIds): met
- Rotate returns a new token once (accountIds): met

## Checks
- tests: passed — 156 server + 22 web tests
- type check: passed
- lint: passed
- format check: passed
- build: passed

## Review
- note: Unknown account-id validation for `PUT /api/configurations/:id/accounts` lives in the route (`configurationsRoutes.ts`) rather than the configurations service; duplicates are checked in the service. Acceptable for this delta; keep unknown-id checks in the service if assignment grows more logic.
- note: `patch` treats any provided `values` object (including `{}`) as requiring `checkConnection`, even when effective values are unchanged. Spec wording targets effective value changes; current HTTP scenarios only cover enabled-only and real value patches.
- note: No product `web/` or MCP tool changes in the branch diff; production connector registry remains empty as designed.

## E2E
- Proposal non-goal: no admin account screen — smoke only on existing UI; full account create/check/delete/cascade with fake connector covered by automated HTTP tests (`server/test/http/accounts-api.test.ts`), not by live process (empty production registry).
- Admin UI Configurations list after API create: passed — heading "Configurations"; list shows "E2E Ops" with Enable/Rotate/Delete; no account assignment controls
- Admin UI Connectors empty state: passed — "No connectors yet. Connector accounts will appear here in a later change."
- Admin UI console: passed — only unrelated `favicon.ico` 404; API GETs to `/api/configurations` and `/api/connectors` returned 200
- Live `GET /api/accounts` empty document: passed — 200 `[]`
- Live configuration create/list/patch include `accountIds`: passed — create 201 with `accountIds: []`; list and patch include `accountIds`; plaintext token absent from list/patch
- Live unknown connector create: passed — 400; accounts list remained `[]`
- Live form Content-Type create account: passed — 415
- Live accounts list CORS: passed — no `Access-Control-Allow-Origin`
- Live `PUT .../accounts` unknown id: passed — 400; configuration `accountIds` stayed `[]`
- Port separation: passed — MCP `:3871/api/accounts` → 404; admin `:3872/mcp` → 404 plain "Not Found"
- MCP `tools/list` with configuration bearer: passed — connect ok, tools `[]` (empty registry; no MCP delta)
- MCP empty / unknown / missing bearer: passed — same Unauthorized rejection

## Leaks
- Admin UI DOM / inputs (Configurations and Connectors): clean — no fixture-secret marker; no password inputs with values
- Admin API JSON (accounts list, configurations list/patch, unknown-connector and form errors): clean — create token and `tokenHash` absent from list/patch; fixture secret absent
- MCP tools/list responses and auth errors: clean
- Browser console: clean of secrets
