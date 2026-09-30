# proxy-runtime

## Result
blockers: 0

## Spec
- Pinned package and spawn without download: met
- One child process per account: met
- Idle stop and restart: met
- Restart after the child exits: met
- Child environment is built from scratch: met
- Production registry still rejects proxy: met

## Checks
- tests: passed — server 231, web 45
- type check: passed
- lint: passed
- format check: passed
- build: passed

## Review
- note: `packages/fake-stdio-mcp/index.js` deletes libuv Windows fill-in variables (`TEMP`, `USERPROFILE`, and `SYSTEMROOT` when it matches `WINDIR`) before `report_env`. `buildChildEnv` is still asserted to return only `PATH`, mapped variables, and `SYSTEMROOT` on Windows, and that object is the spawn `env`.
- note: `server/vitest.config.ts` sets `testTimeout` to 20000 so the existing type-aware ESLint tests finish while the suite runs in parallel.
- note: `waitUntilExited` in `server/test/connectors/proxy/runtime.test.ts` polls for up to 2 seconds after the injected idle stop. It throws if the pid is still alive. The idle test passed in 569ms, so the child had exited. `stopSession` calls `forceKill`, which sends `SIGKILL`.
- note: the unchanged admin shell has no favicon, so the browser logged a 404 for `/favicon.ico`. This change does not edit `web/`.

## E2E
- Production registry includes Gmail and no proxy connector: passed — Connectors showed "Gmail" and "No accounts yet."; `GET /api/connectors` returned `id` `gmail`, `kind` `native`, and no `proxy` connector.
- MCP port tool list has no proxy tools: passed — `tools/list` for a configuration with no accounts returned no tools; `tools/call` `report_env` returned "Unknown tool".
- Empty bearer and unknown bearer: passed — a missing header, `Bearer ` with an empty token, and an unknown bearer were all 401 with body `Unauthorized`.
- MCP port does not serve the admin API: passed — `GET /api/connectors` on the MCP port returned 404 `Not Found`.
- Admin port does not answer MCP: passed — `POST /mcp` on the admin port returned 404 `Not Found`.
- Bearer is shown once: passed — the "Bearer token" dialog was visible, and after Close the dialog was gone. `GET /api/configurations` returned `id`, `name`, `enabled`, and `accountIds` only.

Runtime scenarios for spawn, idle, exit, and the child environment are not on the admin UI or the MCP port. Their tests passed. Idle stop killed the child: the test saw the pid exit before the next call, and the launch count then went from 1 to 2.

## Leaks
- Connectors DOM and input values: clean
- Admin connectors JSON and accounts JSON: clean
- Configuration list JSON: clean
- MCP `tools/list`, `tools/call` error text, `/health`, and 401 bodies: clean
- Browser console: clean
