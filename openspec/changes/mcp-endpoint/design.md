# Design

## Context

See proposal.md — Why. Today `createMcpApp()` registers `GET /health`, an `app.all('/mcp')` 501 stub, and a 404 catch-all. `main.ts` opens the encrypted store and passes it only to `createAdminApp`. Configurations already persist `tokenHash` and `enabled`; `tokenMatchesHash` lives in `server/src/token/token.ts`. `@modelcontextprotocol/sdk` is already a server dependency. The person accepted the design below; open questions are closed.

## Goals / Non-Goals

**Goals:**

- Authenticate every `POST /mcp` against store configuration hashes before JSON-RPC.
- Serve stateless Streamable HTTP with an empty tool list after success.
- Reject `GET`/`DELETE`/other non-POST methods on `/mcp` with 405 before the transport (no SDK SSE stream).
- Keep health, foreign paths, and admin-port `/mcp` 404 unchanged.

**Non-Goals:**

- Tools, custom `tools/call`, accounts, admin UI, sessions, `list_changed`, DNS rebinding protection, legacy SSE endpoint.

## Decisions

### 1. Refusal is HTTP 401 text/plain `Unauthorized` before JSON-RPC

**Decision:** Failed auth returns status 401, `Content-Type: text/plain` (charset optional), body exactly `Unauthorized`. Identical for missing Authorization, empty bearer, unknown token, and disabled configuration. No configuration names; no case distinction.

**Alternatives considered:** JSON-RPC error after transport (rejected — leaks protocol handling and complicates uniform refusal); 403 for disabled (rejected — would distinguish cases).

### 2. GET and DELETE /mcp return 405 before the transport

**Decision:** Reject `GET`, `DELETE`, and other non-POST methods on `/mcp` with HTTP 405 and a short English body before handing off to Streamable HTTP. This SDK's stateless mode still accepts GET as a standalone SSE stream; this change must not open that stream. The path exists, so these are 405, not 404.

**Alternatives considered:** Let the SDK handle GET SSE (rejected — product requires no separate SSE); keep 501 (rejected — endpoint is implemented).

### 3. Stateless Streamable HTTP, one transport per POST

**Decision:** `POST /mcp` uses `@modelcontextprotocol/sdk` Streamable HTTP with one new transport per request: `sessionIdGenerator` undefined (stateless), `enableJsonResponse` true. No session id, no `tools/list_changed` notifications. Token checked on every request via `store.read()`. No separate SSE endpoint.

**Alternatives considered:** Session-based transport (rejected — out of scope); shared transport across requests (rejected — complicates auth re-check and lifecycle).

### 4. Bearer parse and full-scan compare

**Decision:** Scheme case-insensitive; exactly one space; token is the exact remainder (no trim). Compare with existing `tokenMatchesHash` against every stored configuration hash. Do not return before the full scan. Accept only if at least one match is enabled. A disabled-only match is the same 401 as no match.

**Alternatives considered:** Early exit on first match (rejected — timing side channel); trim token (rejected — would accept padded tokens not issued by generate).

### 5. Empty McpServer identity

**Decision:** On success, create an `McpServer` with no tools registered. `tools/list` is empty because there are no connectors yet. Server name `mcp-gateway`, version `0.0.0`.

**Alternatives considered:** Register placeholder tools (rejected — non-goal); omit server identity (rejected — SDK expects name/version).

### 6. Unchanged neighbors

**Decision:** `GET /health`, foreign paths, and admin-port `/mcp` 404 stay as today. DNS rebinding protection stays off (SDK default).

### 7. Store wiring

**Decision:** `createMcpApp` receives the encrypted store (`main.ts` already opens it). Each authenticated POST reads configurations from `store.read()`.

**Alternatives considered:** Pass a configurations service (deferred — store read is enough for this stage); cache matches in memory (rejected — disable/rotate must take effect on the next request).

### 8. Tests

**Decision:** Happy path uses `Client` + `StreamableHTTPClientTransport` from `@modelcontextprotocol/sdk` against `127.0.0.1` on an ephemeral port; `listTools()` is `[]`. Refusal cases assert identical HTTP status and body. No live external service. No browser. Existing tests that expect `/mcp` → 501 are updated in the same apply tasks to the new contract.

## Risks / Trade-offs

- [Full scan of all configuration hashes on every POST] → Acceptable at current scale; revisit only if configuration count becomes large.
- [SDK upgrades change Streamable HTTP defaults] → Pin behavior in tests (405 on GET, empty tools/list, no session).
- [Existing 501 assertions in mcp-port-routing and configurations-api tests fail until updated] → Update those tests in the same tasks that change routing; do not weaken new auth scenarios.

## Migration Plan

- Deploy is a single process restart on the change branch merge; no data migration (store shape unchanged).
- Clients that relied on 501 must send `Authorization: Bearer` on `POST /mcp` and must not use GET `/mcp` for SSE.
- Rollback: revert the change; `/mcp` returns 501 again.

## Open Questions

None — all design points above were accepted before propose.
