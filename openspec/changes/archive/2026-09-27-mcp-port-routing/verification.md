# mcp-port-routing

## Result
blockers: 0

## Spec
- GET /health on the MCP port without authentication: met
- /mcp on the MCP port returns 501: met
- A foreign path on the MCP port is 404: met
- The admin port does not serve /mcp: met

## Checks
- tests: passed — 53 server + 2 web tests, including 13 mcp-port-routing scenarios
- type check: passed
- lint: passed
- format check: passed
- build: passed

## Review
- note: admin `GET /` browser console shows a 404 for `/favicon.ico` (browser default request; not part of the delta and unrelated to port routing)
- note: tree was clean on `change/mcp-port-routing`; `mcp-gateway-spec.md` and `openspec/specs/` unchanged; no secrets in the branch diff

## E2E
- GET /health without Authorization: passed — MCP `127.0.0.1:18765` returned 200, `application/json`, body `{"status":"ok"}`
- GET /health with Authorization does not change the response: passed — same 200 JSON body; bearer absent from body
- GET /health with a query string: passed — `GET /health?x=1` returned 200 `{"status":"ok"}`
- GET /mcp — 501 without secrets: passed — status 501, body `Not Implemented`, no canaries
- POST /mcp — 501 without secrets: passed — status 501, body `Not Implemented`
- Unknown path — 404: passed — `GET /unknown` status 404, body `Not Found`
- POST /health — 404: passed — status 404, body `Not Found`
- PUT /health — 404: passed — status 404, body `Not Found`
- DELETE /health — 404: passed — status 404, body `Not Found`
- GET /health/ — 404: passed — status 404, body `Not Found`
- GET /mcp on admin — 404 before static files: passed — admin `127.0.0.1:18766/mcp` HTTP 404, body `Not Found` (Playwright and fetch)
- POST /mcp on admin — 404: passed — status 404, body `Not Found`
- GET / on admin still returns HTML: passed — Playwright showed heading "MCP Gateway" and "Admin shell"; HTTP 200 HTML shell

## Leaks
- MCP /health, /mcp, /unknown, /health method variants: clean
- Admin /mcp and Admin GET / response bodies: clean
- Admin DOM (outerHTML and inputs) via Playwright evaluate: clean
- Browser console on admin /: clean of secrets (only favicon.ico 404)
