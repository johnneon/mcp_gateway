# Design

## Context

См. `proposal.md` — Why. Каркас `project-skeleton` уже разделяет `createMcpApp` и `createAdminApp` без `listen`; `encrypted-store` открывает store до `listen`. Сейчас `createMcpApp` возвращает пустой Express; `createAdminApp` сразу вешает `express.static` на `web/dist`. Vision: `mcp-gateway-spec.md` (§ HTTP). Текущий контракт старта: `openspec/specs/process-startup/spec.md` (два слушателя и HTML на `/`) — не переписывается. Этап roadmap 4; Streamable HTTP — этап 6 (`mcp-endpoint`).

## Goals / Non-Goals

**Goals:**

- Зафиксировать маршруты MCP: `GET /health`, stub `/mcp` → 501, остальное → 404.
- Защитить admin от обслуживания `/mcp` статикой.
- Автотесты HTTP к фабрикам без `listen` и без живого провайдера.

**Non-Goals:**

- Streamable HTTP, bearer, `/api`, экраны, конфигурации, коннекторы, store.
- Правки `mcp-gateway-spec.md` и `openspec/specs/` до archive.
- Изменение контракта старта (`process-startup`).

## Decisions

Приняты человеком до propose; здесь не переоткрываются.

### 1. GET /health на MCP

- Без аутентификации.
- Статус 200, `Content-Type: application/json`.
- Тело ровно `{ "status": "ok" }` (после `JSON.parse` — объект с одним полем `status` со строкой `ok`).
- Без `DATA_DIR`, `ENCRYPTION_KEY`, хостов и портов в теле.
- Присутствие `Authorization` не меняет ответ.
- Query string (`GET /health?...`) не меняет маршрут.

**Альтернатива (отклонена):** расширенный health с uptime, версией или портами — противоречит «без каталога и секретов» и минимальному этапу 4.

### 2. Путь /mcp на MCP — 501

- Маршрут `/mcp` зарегистрирован для всех методов (`app.all('/mcp', ...)` или эквивалент).
- Ответ: HTTP 501, `Content-Type: text/plain; charset=utf-8`.
- Тело ровно: `Not Implemented` (ASCII, без JSON, без секретов).
- Нет монтирования Streamable HTTP и нет проверки bearer (этап `mcp-endpoint`, issue stage 6).

**Альтернатива (отклонена):** 404 на `/mcp` до появления MCP — хуже: клиент не отличит «ещё не реализовано» от «чужой путь»; roadmap явно регистрирует `/mcp` уже на этапе 4.

### 3. Чужие запросы на MCP — 404

- Финальный обработчик: статус 404, `Content-Type: text/plain; charset=utf-8`, тело ровно `Not Found`.
- Чужими считаются: любой путь кроме `GET /health` и `/mcp`; также `POST`/`PUT`/`DELETE` `/health`; путь `/health/` (trailing slash).
- Express `strict routing` / явная регистрация только `GET /health` без trailing slash — чтобы `/health/` не совпал с health.

**Альтернатива (отклонена):** полагаться на дефолтный HTML 404 Express — длиннее, не English-фиксированный контракт, риск утечки стека в dev.

### 4. /mcp на admin до статики

- В `createAdminApp` до `express.static`: `app.all('/mcp', ...)` → 404, `text/plain; charset=utf-8`, тело `Not Found`.
- Цель: файл в `web/dist` или будущий SPA fallback не сможет отдать `/mcp`.
- `GET /` без изменений: по-прежнему статика / `index.html`.

**Альтернатива (отклонена):** фильтр только в reverse proxy — продукт обязан сам не пересекаться по законам портов.

### 5. Тесты

- HTTP к `createMcpApp()` и `createAdminApp({ webRoot })` через `supertest` (devDependency `@mcp-gateway/server`, плюс `@types/supertest` при необходимости).
- Без вызова `listen` на `MCP_PORT`/`ADMIN_PORT`, без живого MCP-провайдера и без браузера.
- Тестовый `webRoot` — временный каталог с минимальным `index.html` и (для сценария коллизии) файлом, который иначе отдал бы `/mcp`.
- Имена тестов включают требование и сценарий delta; покрытие — скилл `tests`.
- Экраны и Playwright в этом изменении не трогаются.

**Структура (ориентир):**

```text
server/src/http/
  createMcpApp.ts     GET /health, all /mcp → 501, fallback 404
  createAdminApp.ts   all /mcp → 404, затем static
server/test/http/
  mcp-port-routing.test.ts   сценарии delta через supertest
```

## Risks / Trade-offs

- [501 на /mcp до этапа 6 может удивить клиента, который ждёт MCP] → Mitigation: зафиксировано roadmap; этап `mcp-endpoint` заменит обработчик.
- [express.static и точное имя файла-коллизии в тесте зависят от правил раздачи] → Mitigation: в тесте класть файл с именем, которое static реально отдал бы по `/mcp` без явного обработчика; assert сравнивает статус 404 и отсутствие содержимого файла.
- [Жёсткие строки `Not Implemented` / `Not Found`] → Mitigation: одно место в коде маршрутов; сценарии проверяют короткий English без секретов и точный текст из этого дизайна.

## Migration Plan

Чистое добавление маршрутов. Откат — revert коммитов изменения. Миграции данных нет.

## Open Questions

Нет. Решения 1–5 приняты до propose.
