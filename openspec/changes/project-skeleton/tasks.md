# Tasks

## 1. Workspaces и пакеты

- [ ] 1.1 Настроить npm workspaces в корневом `package.json` (`server`, `web`), ES modules, скрипты `typecheck` / `test` / `build` / `start`; создать `server/package.json` и `web/package.json` с зависимостями из design (Express 5, `@modelcontextprotocol/sdk`, zod, Vitest, TypeScript на server; React, Vite, Vitest, TypeScript на web; без Radix, пока shell без него). Проверка: `npm install` завершается без ошибки, в lockfile есть workspaces.

- [ ] 1.2 Добавить TypeScript strict и конфиги Vitest/Vite для обоих пакетов (`tsconfig`, `vitest.config`, `vite.config` с alias `@` → `web/src`), минимальные заглушки entry чтобы `typecheck` не падал на пустоте. Проверка: `npm run typecheck` проходит.

## 2. Окружение

- [ ] 2.1 Реализовать `server/src/env.ts` (`parseEnv`): обязательные `MCP_HOST`, `MCP_PORT`, `ADMIN_PORT`, `DATA_DIR`, `ENCRYPTION_KEY`; `ADMIN_HOST` по умолчанию `127.0.0.1`; пустая строка = отсутствие; ошибка содержит только имя переменной. Автотесты сценариев delta «Нет MCP_HOST|MCP_PORT|ADMIN_PORT|DATA_DIR|ENCRYPTION_KEY» и default `ADMIN_HOST` (юнит на подставном env-объекте, без печати значений). Проверка: `npm test -w server` покрывает эти сценарии и проходит.

## 3. HTTP-приложения и точка входа

- [ ] 3.1 Реализовать `server/src/http/createMcpApp.ts` и `createAdminApp.ts` (Express apps без `listen`; admin раздаёт static production-сборку `web`), `server/src/main.ts` (единственное чтение `process.env` → parseEnv → apps → два listen; при MissingEnv — print имени, `process.exit(1)`). Проверка: модули собираются, `npm run typecheck -w server` проходит.

- [ ] 3.2 Автотесты сценариев «Оба слушателя принимают соединение», «ADMIN_HOST не задана» / «задана явно» и «Корень admin отдаёт HTML оболочки»: spawn процесса с контролируемым env, TCP connect, HTTP GET `/` на admin после `npm run build -w web`. Проверка: тесты проходят; stdout/stderr успешного старта не содержат значений `ENCRYPTION_KEY` и `DATA_DIR`.

## 4. Web shell

- [ ] 4.1 Минимальный React + CSS modules shell в `web/src/app/` (английский текст, без экранов Configurations/Connectors), `index.html`, сборка Vite в dist. Компонентный/smoke-тест оболочки по `frontend-cover-tests` по мере необходимости. Проверка: `npm test -w web`, `npm run build -w web` проходят; dist содержит HTML/JS.

## 5. Корневая проверка

- [ ] 5.1 Довести корневые скрипты так, чтобы `npm run typecheck`, `npm test` и `npm run build` проходили целиком; при необходимости `.env.example` только с именами переменных (без значений-секретов). Проверка: три команды с корня завершаются кодом 0.
