# Tasks

## 1. MCP-приложение: health, stub /mcp, 404

- [x] 1.1 Добавить `supertest` (и типы при необходимости) в devDependencies пакета `server`. В `createMcpApp`: `GET /health` → 200, `Content-Type: application/json`, тело ровно `{ "status": "ok" }`; `app.all('/mcp')` → 501, `text/plain; charset=utf-8`, тело `Not Implemented`; финальный обработчик → 404, тело `Not Found`. Автотесты через `supertest` без `listen`: сценарии GET /health без и с Authorization, с query string; GET/POST /mcp → 501; GET /unknown, POST/PUT/DELETE /health, GET /health/ → 404; тела без секретов/canary. Проверка: новые тесты проходят; `npm run typecheck -w server` — код 0.

## 2. Admin: /mcp до статики

- [x] 2.1 В `createAdminApp` до `express.static` зарегистрировать `app.all('/mcp')` → 404, `text/plain; charset=utf-8`, тело `Not Found`. Автотесты: GET и POST `/mcp` → 404 даже при файле-коллизии в тестовом `webRoot`; GET `/` по-прежнему отдаёт HTML оболочки. Проверка: тесты admin-маршрутизации проходят.

## 3. Полная проверка пакета

- [x] 3.1 С корня: `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build` — код 0. Имена тестов покрывают все сценарии delta `mcp-port-routing`. Проверка: все команды завершаются нулевым кодом.
