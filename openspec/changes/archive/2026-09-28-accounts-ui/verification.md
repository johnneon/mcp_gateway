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
- note: commit `0664eee` deepens archived `e2e/fake-admin-harness.mjs` imports to `../../../../../server/dist/...`. From repo root the harness prints `READY` (no `ERR_MODULE_NOT_FOUND`).
- note: commit `8af1eb5` adds `openspec/**/*.mjs` to ESLint `ignores` only. `@typescript-eslint/no-explicit-any` remains `error` for typed server/web sources; `server/test/ci/eslint-any.test.ts` still fails explicit-`any` fixtures under `server/` and `web/`. Ignore does not weaken that rule for product code.
- note: production connector registry remains empty by design; empty Connectors copy was walked against an empty-registry throwaway admin. Account create/edit/check/disable/delete and configuration checkbox assignment were walked against the archived fake harness.
- note: browser console showed expected `400` on create when the connection check failed; no fixture secret in console. `favicon.ico` 404 only otherwise.
- note: delta scenario title `Non-empty list shows name and fields without account actions` is retained; the scenario body (list without secret keys/values) is what the page and RTL test implement. Account actions are covered by the ADDED requirements.
- note: `openspec/specs/admin-configurations-ui/spec.md` updated at archive (finish); no apply-time edit of `mcp-gateway-spec.md`. No explicit `any` in change sources. No new server routes.

## E2E
- Empty API list keeps the empty-state copy: passed — empty-registry admin Connectors showed exactly `No connectors yet.`; old deferred-accounts sentence absent
- Non-empty list shows name and fields without account actions: passed — harness listed `Fake` / `Box` / `Enabled` / `user: alice` (later `user: bob`); no `token:` key; fixture secret absent from DOM
- Create sends full values and clears secret input after success: passed — created `Box`; dialog closed; `fixture-secret-value` absent from DOM/inputs; `GET /api/accounts` values had only non-secret keys
- Edit omits blank secret keys: passed — edit left Token blank, changed User to `bob`, Save succeeded; row showed `user: bob`; fixture secret still absent
- Create connection-check failure shows API error text: passed — create with `fail-check` showed alert `Connection check failed`; no connector exception text or stack
- Check connection calls the check route: passed — network showed `POST .../check` 200 for that action
- Disable sends enabled-only PATCH: passed — checkbox toggled label to `Disabled`; `PATCH` observed
- Delete without confirmation does not call the API: passed — Cancel left `Box` listed; no `DELETE` in network log
- Delete requires confirmation then removes the row: passed — Confirm delete; Connectors showed `No accounts yet.`; Configurations `Accounts for MCP Smoke` no longer listed `Box`
- Toggle assigns the full accountIds list: passed — checking `Assign Box to MCP Smoke` sent `PUT .../accounts` 200; no bearer reveal from the toggle
- Disabled account may be assigned from the UI: passed — `Box (disabled)` checkbox became checked after toggle
- Uncheck removes the id from the full list: passed — uncheck sent a second `PUT .../accounts` 200
- MCP port separation and bearer rejection: passed — MCP `/api/configurations` 404; admin `/mcp` 404; empty and unknown bearer both 401; valid bearer `tools/list` returned empty tools; token absent from list JSON and tools/list (`e2e/mcp-smoke.mjs`)
- Archived harness start: passed — `node openspec/changes/archive/2026-09-28-accounts-ui/e2e/fake-admin-harness.mjs` printed `READY`

## Leaks
- harness admin UI DOM / inputs after create/edit (fixture secret): clean
- admin `GET /api/accounts` and configurations checkbox flow: clean — secret keys and plaintext bearer absent after reveal close
- browser console: clean of secrets (expected create 400 only)
- MCP tools/list and unauthorized responses: clean
