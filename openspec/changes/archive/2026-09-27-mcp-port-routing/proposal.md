# Proposal

Issue: #8

## Why

The two HTTP listeners already accept TCP connections, but the MCP port is empty and the admin port serves only static files. Without explicit routes, a foreign path can get Express's default response or, on admin, a stray file from `web/dist`. The vision and stage 4 require the ports to answer only on the allowed paths and not to reveal the data directory, the key, or hosts.

## What Changes

- The MCP port gains `GET /health` with no authentication: JSON exactly `{ "status": "ok" }`, with no directory, key, hosts, or ports.
- The path `/mcp` on the MCP port is registered and returns HTTP 501 with a short English body. Streamable HTTP and bearer auth are outside this change (stage `mcp-endpoint`).
- Any other path on the MCP port is HTTP 404 with a short English body and no secrets. `POST`/`PUT`/`DELETE` `/health` and `/health/` are 404. A query string on `GET /health` does not change the route.
- The admin port has an explicit `/mcp` handler (every method) that returns 404 before static files, so a file from `web/dist` or a future SPA fallback cannot serve that path. `GET /` still returns the shell HTML.
- Automated tests are HTTP against `createMcpApp()` and `createAdminApp()` without `listen` and without a live provider. Screens are not touched.

## Non-goals

- Streamable HTTP, bearer authentication, and a real MCP on `/mcp`.
- The admin API `/api`, admin UI screens, configurations, and connectors.
- Changes to the encrypted store.
- Edits to `mcp-gateway-spec.md` and files under `openspec/specs/` (sync happens at archive).

## Capabilities

### New Capabilities

- `mcp-port-routing`: routing and responses of the MCP and admin ports for `/health`, `/mcp`, and foreign requests; no secrets in bodies; tests against the app factories without `listen`.

### Modified Capabilities

- (none) — `process-startup` already covers the two listeners and HTML at the admin root; startup requirements do not change.

## Impact

- `server/src/http/createMcpApp.ts`: routes `GET /health`, `/mcp` → 501, everything else → 404.
- `server/src/http/createAdminApp.ts`: explicit `/mcp` → 404 before `express.static`.
- New tests in `server/test/` (HTTP against the apps through supertest or an equivalent, without `listen`).
- `main.ts`, env, store, and the web UI — no contract change.
