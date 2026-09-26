# Proposal

## Why

В репозитории есть только корневой `package.json` с OpenSpec и нет запускаемого приложения. Без каркаса workspaces, объявленных зависимостей и процесса на двух адресах нельзя реализовать эпик «процесс и хранилище» и проверять последующие изменения.

## What Changes

- Репозиторий становится npm-workspaces приложением: пакеты `server/` и `web/`, корневые скрипты typecheck, test и build.
- В `server/` появляется точка входа: разбор окружения, два Express-приложения (MCP и admin) и `listen` на обоих адресах.
- Имена переменных окружения фиксируются: `MCP_HOST`, `MCP_PORT`, `ADMIN_HOST`, `ADMIN_PORT`, `DATA_DIR`, `ENCRYPTION_KEY`. При отсутствии обязательной переменной процесс завершается с ненулевым кодом и печатает только имя переменной.
- `ADMIN_HOST` при отсутствии значения по умолчанию `127.0.0.1` (как в спецификации); остальные пять переменных обязательны при старте, включая `DATA_DIR` и `ENCRYPTION_KEY` (хранилище в этом изменении не реализуется).
- В `web/` — минимальный Vite + React + TypeScript shell, чтобы admin-процесс мог раздавать production-сборку.
- Зависимости из «Стек» и «Сборка репозитория» (`mcp-gateway-spec.md`) объявляются: Express 5, `@modelcontextprotocol/sdk`, zod, Vitest, React, Vite; Radix — только если нужен для shell.

## Non-goals

- Зашифрованное JSON-хранилище, запись через временный файл, поведение при ошибке расшифровки (`implementation.md` 1.2).
- Тело ответа `GET /health` (1.3).
- Ограничение порта MCP только `/mcp` и `/health`, запрет MCP на admin-порте (1.4).
- API конфигураций, MCP `tools/list` / `tools/call`, экраны Configurations и Connectors, контракт коннектора, proxy, журнал вызовов.
- Dockerfile, compose, вход (login) в admin UI.
- Каталоги `store/`, `configurations/`, `accounts/`, `connectors/`, `mcp/` (маршрутизация инструментов) — в следующих изменениях.

## Capabilities

### New Capabilities

- `process-startup`: разбор обязательных переменных окружения, выход с именем недостающей переменной без значений, два HTTP-слушателя (MCP и admin), значение `ADMIN_HOST` по умолчанию `127.0.0.1`, раздача статики admin-сборки.

### Modified Capabilities

- (нет — `openspec/specs/` пуст)

## Impact

- Корневой `package.json` (workspaces, скрипты), новые пакеты `server/` и `web/`.
- Новые зависимости runtime и dev (см. design).
- Точка входа процесса: `server/src/main.ts`; единственное чтение `process.env`.
- Автотесты сценариев окружения и слушателей на Vitest без внешних сервисов.
