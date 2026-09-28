# connector-contract

## Result
blockers: 0

## Spec
- Native connector module shape: met
- Account field description: met
- Allowed destinations as host and port pairs: met
- Registry build validates and rejects proxy: met
- Production registry is empty: met
- List connectors public description: met
- GET connectors needs no JSON Content-Type: met
- No CORS headers on connectors API responses: met
- Connectors list from API: met
- Show English errors from failed connectors list: met

## Checks
- tests: passed — server 113, web 22
- type check: passed
- lint: passed
- format check: passed
- build: passed

## Review
- note: browser console shows favicon.ico 404 on admin root; unrelated to this delta (same as prior admin UI verification)
- note: non-empty Connectors UI and list-error paths are covered by RTL with the change's fake JSON fixture; live production registry remains empty by design
- note: `web/src/features/connectors/api.ts` has no dedicated unit file; behavior is covered through `ConnectorsPage.test.tsx` and `App.test.tsx`

## E2E
- Empty API list keeps the empty-state copy: passed — live admin UI at `http://127.0.0.1:18792/` showed heading "Connectors" and exact copy `No connectors yet. Connector accounts will appear here in a later change.`; network showed `GET /api/connectors` → 200; no account action buttons; see `e2e/README.md`
- Non-empty list shows name and fields without account actions: passed — covered by `ConnectorsPage.test.tsx` with fake public description; live process correctly stays empty (production registry length 0). HTTP inject of fake registry via `createAdminApp` returned public shape only (`Fake`, fields Token/Mail host) without destinations or `checkConnection`
- Connectors list error is shown in English: passed — covered by `ConnectorsPage.test.tsx` (alert with English body; no secret values)
- Empty registry lists as empty array: passed — live `GET /api/connectors` → 200 `[]`
- Fake connector is listed without internals: passed — injectable fake registry HTTP check; body omitted hosts/ports, `allowedDestinations`, and `checkConnection`
- GET without Content-Type returns 200: passed — live GET without Content-Type → 200
- Successful connectors list has no CORS headers: passed — live and injectable responses had no `Access-Control-Allow-*` headers
- MCP port does not serve admin API / admin does not answer MCP: passed — MCP `GET /api/connectors` → 404; admin `GET /mcp` → 404
- Empty and unknown bearer rejected the same; valid bearer tools/list: passed — both unauthorized without token leak; valid bearer `tools/list` → `{ "tools": [] }` without token in body

## Leaks
- admin UI DOM / inputs on Connectors (empty): clean
- admin `GET /api/connectors` JSON (empty and fake-injected): clean
- browser console (aside from favicon 404): clean
- MCP client tools/list and empty/unknown bearer errors: clean
