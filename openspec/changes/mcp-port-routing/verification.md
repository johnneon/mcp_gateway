# mcp-port-routing

## Result
blockers: 0

## Spec
- GET /health на порту MCP без аутентификации: met
- /mcp на порту MCP возвращает 501: met
- Чужой путь на порту MCP — 404: met
- Порт admin не обслуживает /mcp: met

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
- GET /health без Authorization: passed — MCP `127.0.0.1:18765` returned 200, `application/json`, body `{"status":"ok"}`
- GET /health с Authorization не меняет ответ: passed — same 200 JSON body; bearer absent from body
- GET /health с query string: passed — `GET /health?x=1` returned 200 `{"status":"ok"}`
- GET /mcp — 501 без секретов: passed — status 501, body `Not Implemented`, no canaries
- POST /mcp — 501 без секретов: passed — status 501, body `Not Implemented`
- Неизвестный путь — 404: passed — `GET /unknown` status 404, body `Not Found`
- POST /health — 404: passed — status 404, body `Not Found`
- PUT /health — 404: passed — status 404, body `Not Found`
- DELETE /health — 404: passed — status 404, body `Not Found`
- GET /health/ — 404: passed — status 404, body `Not Found`
- GET /mcp на admin — 404 до статики: passed — admin `127.0.0.1:18766/mcp` HTTP 404, body `Not Found` (Playwright and fetch)
- POST /mcp на admin — 404: passed — status 404, body `Not Found`
- GET / на admin по-прежнему HTML: passed — Playwright showed heading "MCP Gateway" and "Admin shell"; HTTP 200 HTML shell

## Leaks
- MCP /health, /mcp, /unknown, /health method variants: clean
- Admin /mcp and Admin GET / response bodies: clean
- Admin DOM (outerHTML and inputs) via Playwright evaluate: clean
- Browser console on admin /: clean of secrets (only favicon.ico 404)
