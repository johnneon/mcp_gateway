# Proposal

Issue: #9

## Why

The encrypted store and the two HTTP ports exist, but the operator still has no way to create or manage configurations. Without an admin API that issues a bearer once and stores only its hash, later MCP auth and the Configurations screen have nothing to build on. The product-spec implementation-order line that pairs configurations with MCP `tools/list` is out of scope here: this change is API only, as accepted for issue #9.

## What Changes

- A configurations domain on top of the encrypted store: document shape `{ configurations: [{ id, name, tokenHash, enabled }] }`. An existing empty document `{}` reads as an empty list. No `accountIds` (accounts do not exist yet).
- Token module: 32 cryptographically random bytes as a base64url string; persist SHA-256 of that exact string; `crypto.timingSafeEqual` compare helper lives with the token module (no MCP lookup in this change).
- Admin-port HTTP API (service has no Express; zod validates bodies):
  - `POST /api/configurations` `{ name }` → 201 `{ id, name, enabled: true, token }`
  - `GET /api/configurations` → list of `{ id, name, enabled }` (no token, no hash)
  - `POST /api/configurations/:id/rotate` → new token once; previous hash replaced immediately
  - `PATCH /api/configurations/:id` `{ enabled }` → enable or disable
  - `DELETE /api/configurations/:id` → 204
- Entire `/api`: a mutation without `Content-Type: application/json` (including a form body) is rejected with 415 and does not change state; `application/json; charset=utf-8` is accepted. No CORS headers on any `/api` response, including errors.
- `createAdminApp` receives the opened store; `main.ts` keeps the store and passes it in. MCP port unchanged: `/mcp` stays 501. No bearer auth, `tools/list`, or Streamable HTTP.
- Automated tests later (apply): supertest against a fake store — JSON mutations, form rejection, token and hash absent from the list and from plaintext on disk.

## Non-goals

- MCP bearer lookup, empty `tools/list`, and Streamable HTTP (product-spec order line "configurations in API and MCP with empty tools/list" is explicitly out; API only).
- Admin UI / Configurations screen.
- Accounts, account checkboxes, and connectors.
- CORS (headers must stay absent).
- Admin login.
- Edits to `mcp-gateway-spec.md` and files under `openspec/specs/` (sync happens at archive).

## Capabilities

### New Capabilities

- `configurations-api`: configurations document shape and service; bearer token generation, SHA-256 persistence, and timing-safe compare; admin `/api/configurations` routes; `/api` Content-Type and no-CORS rules; wiring the store into `createAdminApp` / `main.ts`.

### Modified Capabilities

- (none) — `encrypted-store` keeps `open` / `read` / `replace`; `process-startup` and `mcp-port-routing` requirements do not change (`/mcp` on MCP stays 501; admin `/mcp` stays 404 before static).

## Impact

- New modules under `server/src/` (token helper, configurations service, admin `/api` routes).
- `server/src/http/createAdminApp.ts`: accepts the store, mounts `/api` before static files.
- `server/src/main.ts`: retains the opened store and passes it into `createAdminApp`.
- `zod` is already a server dependency; tests use existing `supertest` against a fake store.
- MCP app, web UI, and encrypted-store codec — no contract change in this change.
