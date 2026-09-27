# Proposal

Issue: #8

## Why

Два HTTP-слушателя уже принимают TCP-соединения, но порт MCP пустой, а порт admin отдаёт только статику. Без явных маршрутов чужой путь может получить ответ по умолчанию Express или, на admin, случайный файл из `web/dist`. Vision и этап 4 требуют, чтобы порты отвечали только на разрешённые пути и не раскрывали каталог данных, ключ и хосты.

## What Changes

- На порту MCP появляется `GET /health` без аутентификации: JSON ровно `{ "status": "ok" }`, без каталога, ключа, хостов и портов.
- Путь `/mcp` на порту MCP зарегистрирован и отвечает HTTP 501 с коротким английским телом; Streamable HTTP и bearer — вне этого изменения (этап `mcp-endpoint`).
- Любой другой путь на порту MCP — HTTP 404 с коротким английским телом без секретов; `POST`/`PUT`/`DELETE` `/health` и `/health/` — 404; query string на `GET /health` маршрут не меняет.
- На порту admin явный обработчик `/mcp` (все методы) возвращает 404 до статики, чтобы файл из `web/dist` или будущий SPA fallback не обслужил этот путь. `GET /` по-прежнему отдаёт HTML оболочки.
- Автотесты — HTTP к `createMcpApp()` и `createAdminApp()` без `listen` и без живого провайдера. Экраны не затрагиваются.

## Non-goals

- Streamable HTTP, bearer-аутентификация, полноценный MCP на `/mcp`.
- Admin API `/api`, экраны admin UI, конфигурации, коннекторы.
- Изменения зашифрованного хранилища.
- Правки `mcp-gateway-spec.md` и файлов под `openspec/specs/` (синхронизация — при archive).

## Capabilities

### New Capabilities

- `mcp-port-routing`: маршрутизация и ответы портов MCP и admin по путям `/health`, `/mcp` и чужим запросам; отсутствие секретов в телах; тесты на фабриках приложений без `listen`.

### Modified Capabilities

- (нет) — `process-startup` уже покрывает два слушателя и HTML на корне admin; требования старта не меняются.

## Impact

- `server/src/http/createMcpApp.ts`: маршруты `GET /health`, `/mcp` → 501, остальное → 404.
- `server/src/http/createAdminApp.ts`: явный `/mcp` → 404 до `express.static`.
- Новые тесты в `server/test/` (HTTP к apps через supertest или эквивалент без `listen`).
- `main.ts`, env, store, web UI — без изменений контракта.
