# Tasks

## 1. Wire store into MCP app and method gates

- [x] 1.1 Change `createMcpApp` to accept the encrypted store (same pattern as `createAdminApp`). In `main.ts`, pass the opened store into `createMcpApp`. On `/mcp`, return 405 with short English `text/plain` for `GET`, `DELETE`, and any method other than `POST` before any Streamable HTTP transport (no SSE). Update existing mcp-port-routing and configurations-api tests that assert `/mcp` → 501 so they expect 405 for GET/DELETE and 401 for unauthenticated POST (body exactly `Unauthorized`). Check: those updated routing tests pass; `npm run typecheck -w server` exits 0.

## 2. Bearer auth gate

- [x] 2.1 On `POST /mcp`, parse `Authorization` (scheme case-insensitive, exactly one space, token = exact remainder with no trim). Scan every configuration from `store.read()` with `tokenMatchesHash`; do not return before the full scan; accept only if at least one match is `enabled`. On failure (missing header, empty bearer, unknown token, disabled-only match), respond 401, `Content-Type` text/plain, body exactly `Unauthorized`, before JSON-RPC. Automated tests cover all four refusal cases with identical status and body, and assert no configuration names leak. Check: the new auth refusal tests pass.

## 3. Stateless Streamable HTTP and empty tools/list

- [x] 3.1 After successful auth, handle `POST /mcp` with `@modelcontextprotocol/sdk` Streamable HTTP: one new transport per request, `sessionIdGenerator` undefined, `enableJsonResponse` true; `McpServer` name `mcp-gateway`, version `0.0.0`, no tools registered. Happy-path test: listen on `127.0.0.1` ephemeral port; `Client` + `StreamableHTTPClientTransport` with an enabled configuration bearer; initialize succeeds; `listTools()` is `[]`. Check: the happy-path test passes; no session id required across requests for this contract.

## 4. Full package check

- [ ] 4.1 From the root: `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build` exit 0. Test names cover every scenario of the `mcp-endpoint`, modified `mcp-port-routing`, and removed `configurations-api` freeze deltas. Check: every command exits 0.
