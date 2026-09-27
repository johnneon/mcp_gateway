# Design

## Context

See `proposal.md` — Why. The `project-skeleton` frame already splits `createMcpApp` and `createAdminApp` without `listen`; `encrypted-store` opens the store before `listen`. Right now `createMcpApp` returns an empty Express app; `createAdminApp` mounts `express.static` on `web/dist` immediately. Vision: `mcp-gateway-spec.md` (HTTP section). The current startup contract is `openspec/specs/process-startup/spec.md` (two listeners and HTML at `/`) and is not rewritten. This is roadmap stage 4; Streamable HTTP is stage 6 (`mcp-endpoint`).

## Goals / Non-Goals

**Goals:**

- Fix the MCP routes: `GET /health`, a `/mcp` stub → 501, everything else → 404.
- Keep admin from serving `/mcp` as a static file.
- HTTP automated tests against the factories, without `listen` and without a live provider.

**Non-Goals:**

- Streamable HTTP, bearer, `/api`, screens, configurations, connectors, and the store.
- Edits to `mcp-gateway-spec.md` and `openspec/specs/` before archive.
- Changing the startup contract (`process-startup`).

## Decisions

Accepted by the person before propose; they are not reopened here.

### 1. GET /health on MCP

- No authentication.
- Status 200, `Content-Type: application/json`.
- Body exactly `{ "status": "ok" }` (after `JSON.parse`, an object with one field `status` whose string is `ok`).
- No `DATA_DIR`, `ENCRYPTION_KEY`, hosts, or ports in the body.
- A present `Authorization` header does not change the response.
- A query string (`GET /health?...`) does not change the route.

**Alternative (rejected):** an extended health with uptime, a version, or ports — that contradicts "no directory and no secrets" and the minimal stage 4.

### 2. Path /mcp on MCP — 501

- The route `/mcp` is registered for every method (`app.all('/mcp', ...)` or equivalent).
- Response: HTTP 501, `Content-Type: text/plain; charset=utf-8`.
- Body exactly: `Not Implemented` (ASCII, no JSON, no secrets).
- No Streamable HTTP mount and no bearer check (stage `mcp-endpoint`).

**Alternative (rejected):** 404 on `/mcp` until MCP exists — worse, because a client cannot tell "not implemented yet" from "a foreign path". The roadmap registers `/mcp` already at stage 4.

### 3. Foreign requests on MCP — 404

- Final handler: status 404, `Content-Type: text/plain; charset=utf-8`, body exactly `Not Found`.
- Foreign means: any path other than `GET /health` and `/mcp`; also `POST`/`PUT`/`DELETE` `/health`; the path `/health/` (trailing slash).
- Express `strict routing` / registering only `GET /health` without a trailing slash, so `/health/` does not match health.

**Alternative (rejected):** relying on Express's default HTML 404 — longer, not a fixed English contract, and a risk of leaking a stack in dev.

### 4. /mcp on admin before static files

- In `createAdminApp`, before `express.static`: `app.all('/mcp', ...)` → 404, `text/plain; charset=utf-8`, body `Not Found`.
- Goal: a file in `web/dist` or a future SPA fallback cannot serve `/mcp`.
- `GET /` is unchanged: still static files / `index.html`.

**Alternative (rejected):** a filter only in the reverse proxy — the product itself must not overlap, by the port laws.

### 5. Tests

- HTTP against `createMcpApp()` and `createAdminApp({ webRoot })` through `supertest` (a devDependency of `@mcp-gateway/server`, plus `@types/supertest` if needed).
- No `listen` on `MCP_PORT`/`ADMIN_PORT`, no live MCP provider, and no browser.
- The test `webRoot` is a temp directory with a minimal `index.html` and (for the collision scenario) a file that would otherwise be served at `/mcp`.
- Test names include the delta requirement and scenario; coverage follows the `tests` skill.
- Screens and Playwright are not touched in this change.

**Structure (guide):**

```text
server/src/http/
  createMcpApp.ts     GET /health, all /mcp → 501, fallback 404
  createAdminApp.ts   all /mcp → 404, then static
server/test/http/
  mcp-port-routing.test.ts   delta scenarios through supertest
```

## Risks / Trade-offs

- [501 on /mcp before stage 6 may surprise a client that expects MCP] → Mitigation: recorded in the roadmap; stage `mcp-endpoint` replaces the handler.
- [express.static and the exact colliding file name in the test depend on how files are served] → Mitigation: the test places a file with the name static would actually serve at `/mcp` without the explicit handler; the assert compares status 404 and the absence of the file contents.
- [Fixed strings `Not Implemented` / `Not Found`] → Mitigation: one place in the route code; scenarios check short English with no secrets and the exact text from this design.

## Migration Plan

A pure addition of routes. Rollback is reverting the change's commits. There is no data migration.

## Open Questions

None. Decisions 1–5 were accepted before propose.
