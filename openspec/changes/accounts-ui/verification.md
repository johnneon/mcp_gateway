# accounts-ui

## Result
blockers: 0

## Spec
- Connectors list from API: met
- Account form from connector field descriptions: met
- Check connection, disable, and delete account: met
- Configuration account checkboxes by connector: met

## Checks
- tests: passed — server 156, web 45
- type check: passed
- lint: passed
- format check: passed
- build: passed

## Review
- note: production connector registry remains empty by design; live `npm start` covers empty Connectors / Configurations assign copy and MCP port separation. Account create/edit/check/disable/delete and configuration checkbox assignment were walked in the browser against a throwaway admin harness that injects the same fake native connector used by `server/test/http/accounts-api.test.ts` (`openspec/changes/accounts-ui/e2e/fake-admin-harness.mjs`).
- note: browser console shows `favicon.ico` 404 on admin load (same as prior admin UI verifications); expected `400` on create when the connection check fails.
- note: delta scenario title `Non-empty list shows name and fields without account actions` is retained; the scenario body (list without secret keys/values) is what the page and RTL test implement. Account actions are covered by the ADDED requirements.
- note: no changes to `mcp-gateway-spec.md` or `openspec/specs/`; no explicit `any`; no new server routes.

## E2E
- Empty API list keeps the empty-state copy: passed — production admin Connectors showed exactly `No connectors yet.`; old deferred-accounts sentence absent
- Non-empty list shows name and fields without account actions: passed — harness listed `Fake` / `Box` / `Enabled` / `user: alice`; no `token:` key; fixture secret absent from DOM
- Create sends full values and clears secret input after success: passed — created `Box`; dialog closed; `fixture-secret-value` absent from DOM/inputs; `GET /api/accounts` values had only `user`
- Edit omits blank secret keys: passed — edit left Token blank, changed User to `bob`, Save succeeded; row showed `user: bob`; fixture secret still absent
- Create connection-check failure shows API error text: passed — create with failing check showed alert `Connection check failed`; no connector exception text or stack
- Check connection calls the check route: passed — network showed only `POST .../check` 200 for that action
- Disable sends enabled-only PATCH: passed — checkbox toggled label to `Disabled`; `PATCH` observed
- Delete without confirmation does not call the API: passed — Cancel left `Box` listed; no `DELETE` in network log
- Delete requires confirmation then removes the row: passed — Confirm delete; Connectors showed `No accounts yet.`; Configurations `Accounts for Ops` no longer listed `Box`
- Toggle assigns the full accountIds list: passed — checking `Assign Box to Ops` sent `PUT .../accounts` 200; no bearer reveal from the toggle
- Disabled account may be assigned from the UI: passed — `Box (disabled)` checkbox became checked after toggle
- Uncheck removes the id from the full list: passed — uncheck sent a second `PUT .../accounts` 200
- MCP port separation and bearer rejection: passed — MCP `/api/configurations` 404; admin `/mcp` 404; empty and unknown bearer both 401; valid bearer `tools/list` returned empty tools; token absent from list JSON and tools/list (`e2e/mcp-smoke.mjs`)

## Leaks
- production admin UI DOM / inputs after bearer reveal close: clean
- harness admin UI DOM / inputs after create/edit (fixture secret): clean
- admin `GET /api/accounts` and `GET /api/configurations` JSON: clean — secret keys and plaintext bearer absent
- browser console: clean of secrets (favicon 404 and expected create 400 only)
- MCP tools/list and unauthorized responses: clean
