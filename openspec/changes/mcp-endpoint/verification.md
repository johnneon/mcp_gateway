# mcp-endpoint

## Result
blockers: 0

## Spec
- Bearer authentication before JSON-RPC on POST /mcp: met
- Identical Unauthorized refusal for failed auth: met
- Stateless Streamable HTTP with empty tools/list: met
- /mcp on the MCP port serves Streamable HTTP after auth: met
- REMOVED /mcp on the MCP port returns 501: met
- REMOVED configurations-api MCP port stays unchanged: met

## Checks
- tests: passed — 100 server + 2 web tests
- type check: passed
- lint: passed
- format check: passed
- build: passed

## Review
- note: `createMcpApp` casts the Streamable HTTP transport `as Transport` to satisfy `exactOptionalPropertyTypes` (`server/src/http/createMcpApp.ts`).
- note: `authenticateBearer` returns early for an empty token before the hash scan (`server/src/mcp/auth.ts`); observable 401 body matches the delta.

## E2E
- GET /mcp — 405 without secrets and without SSE: passed — status 405, body `Method Not Allowed`, not event-stream
- DELETE /mcp — 405 without secrets: passed — status 405, body `Method Not Allowed`
- POST /mcp without Authorization — 401 not 501: passed — status 401, body `Unauthorized`
- Missing Authorization — 401 Unauthorized: passed — body `Unauthorized`, no configuration names
- Empty bearer — same 401 as missing: passed — body `Unauthorized`
- Unknown token — same 401 as missing: passed — body `Unauthorized`
- Disabled configuration bearer is refused like unknown: passed — body `Unauthorized`
- Four refusal cases are byte-identical: passed — all four bodies exactly `Unauthorized`
- Enabled configuration bearer is accepted: passed — status 200, initialize result, not Unauthorized
- Initialize and empty tools/list with enabled bearer: passed — SDK client `listTools()` returned `[]`
- No session id on successful POST: passed — no `mcp-session-id`; follow-up `tools/list` returned `[]`
- Admin GET /mcp — 404: passed — body `Not Found`
- Admin POST /mcp — 404: passed — body `Not Found`
- MCP port does not serve admin API: passed — `/api/configurations` on MCP port returned 404
- Admin UI screens: skipped — this change does not add or change an admin screen

## Leaks
- MCP 401/405 response bodies: clean
- MCP initialize and tools/list responses: clean
- Admin GET /api/configurations after create: clean
- Branch commits (origin/main...HEAD): clean — no `.env`, keys, or data directory
