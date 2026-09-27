# Proposal

Issue: #10

## Why

Configurations and their hashed bearers already exist on the admin API, but the MCP port still answers `/mcp` with 501. Without Streamable HTTP behind bearer lookup, an MCP client cannot initialize or receive `tools/list`, and the product-spec order line for configurations plus an empty tool list cannot start.

## What Changes

- **BREAKING** for MCP-port `/mcp`: replace the 501 stub. After a successful bearer check, `POST /mcp` serves MCP Streamable HTTP (stateless). `GET`, `DELETE`, and other methods on `/mcp` return 405 (not 501).
- Bearer authentication on every `POST /mcp`: parse `Authorization: Bearer <token>`, compare against every stored configuration hash with the existing `tokenMatchesHash`, accept only when at least one match is enabled. Missing header, empty bearer, unknown token, and disabled-only match all receive the same HTTP 401 with body exactly `Unauthorized` before any JSON-RPC.
- On success: an `McpServer` with no tools registered (`tools/list` is `[]`), server name `mcp-gateway`, version `0.0.0`.
- `createMcpApp` receives the encrypted store (already opened in `main.ts`); each authenticated POST reads configurations from `store.read()`.
- Automated tests: SDK `Client` + `StreamableHTTPClientTransport` for the happy path; identical HTTP status and body for the four refusal cases. No live external service; no browser.
- Spec deltas: new `mcp-endpoint` capability; modify `mcp-port-routing` (501 → Streamable HTTP / 405); remove or rewrite the `configurations-api` freeze that kept `/mcp` at 501.

## Non-goals

- Tools, a custom `tools/call` handler, accounts, `accountIds`.
- Admin UI.
- Sessions, `tools/list_changed` notifications, DNS rebinding protection.
- A legacy SSE endpoint.
- Edits to `mcp-gateway-spec.md` and files under `openspec/specs/` (sync at archive).

## Capabilities

### New Capabilities

- `mcp-endpoint`: bearer lookup on `POST /mcp`, identical 401 refusals, empty `tools/list` via Streamable HTTP (stateless, one transport per request), wiring the store into `createMcpApp` / `main.ts`.

### Modified Capabilities

- `mcp-port-routing`: replace the requirement that `/mcp` returns 501; `POST /mcp` is Streamable HTTP after auth; `GET`, `DELETE`, and other methods on `/mcp` are 405. Health, foreign-path, and admin-port `/mcp` 404 requirements stay.
- `configurations-api`: remove the requirement "MCP port stays unchanged" / scenario "GET /mcp remains 501" so archived specs do not contradict this change.

## Impact

- `server/src/http/createMcpApp.ts`: accept the store; auth gate; Streamable HTTP on `POST /mcp`; 405 for other methods on `/mcp`.
- `server/src/main.ts`: pass the opened store into `createMcpApp`.
- Existing `server/src/token/token.ts` `tokenMatchesHash` reused; no new token crypto.
- Dependency `@modelcontextprotocol/sdk` already present; tests use its client transport against `127.0.0.1` on an ephemeral port.
- Existing mcp-port-routing and configurations-api tests that assert `/mcp` → 501 must be updated to match the new contract in the same apply tasks.
- Admin app, configurations API shape, encrypted store codec, and web UI — no contract change beyond retiring the 501 freeze.
