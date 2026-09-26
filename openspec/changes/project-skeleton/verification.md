# project-skeleton

## Result
blockers: 0

## Spec
- Обязательные переменные окружения при старте: met
- ADMIN_HOST по умолчанию 127.0.0.1: met
- Два HTTP-слушателя при полном окружении: met
- Admin раздаёт production-сборку web: met

## Checks
- tests: passed — 14 server + 2 web tests
- type check: passed
- build: passed

## Review
- note: `web/src/app/App.module.css` uses raw color and spacing values instead of CSS tokens from `app/styles/tokens.css` (no tokens file yet; acceptable for this minimal shell).
- note: `zod` is declared in `server/package.json` but unused; `parseEnv` validates ports with `Number` instead.
- note: browser requested `/favicon.ico` during e2e and got 404; product has no favicon. Not part of any delta scenario.
- note: spawn readiness in `server/test/process-startup.test.ts` polls with short `setTimeout` sleeps; appropriate for process startup waits.

## E2E
- Нет MCP_HOST: passed — exit 1, stderr `MCP_HOST`, no secret samples
- Нет MCP_PORT: passed — exit 1, stderr `MCP_PORT`, no secret samples
- Нет ADMIN_PORT: passed — exit 1, stderr `ADMIN_PORT`, no secret samples
- Нет DATA_DIR: passed — exit 1, stderr `DATA_DIR`, no secret samples
- Нет ENCRYPTION_KEY: passed — exit 1, stderr `ENCRYPTION_KEY`, no secret samples
- ADMIN_HOST не задана: passed — process stayed up; admin TCP on `127.0.0.1` (automated spawn suite)
- ADMIN_HOST задана явно: passed — admin TCP on configured host (automated spawn suite + live `127.0.0.1:18766`)
- Оба слушателя принимают соединение: passed — TCP connect to MCP `18765` and admin `18766`
- Корень admin отдаёт HTML оболочки: passed — HTTP 200, HTML with "MCP Gateway" / "Admin shell"; Playwright snapshot showed heading and paragraph; no Configurations/Connectors

## Leaks
- Missing-env stderr/stdout: clean
- Successful-start process stdout/stderr (node): clean — ENCRYPTION_KEY and DATA_DIR values not printed by the process
- Admin GET `/` response body: clean
- Admin UI DOM and inputs (Playwright evaluate): clean
- Browser console: clean of secrets (only browser favicon 404)
