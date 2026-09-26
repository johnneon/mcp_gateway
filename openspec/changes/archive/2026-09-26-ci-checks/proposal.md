# Proposal

## Why

После каркаса процесса слияние в `main` ничем не защищено: на GitHub нет обязательных проверок, а локально нет единого lint/format-контракта. Этап 2 дорожной карты (`docs/roadmap.md`) и расширение человека закрывают этот зазор до следующих продуктовых изменений.

## What Changes

- На каждый pull request в `main` GitHub Actions на Node.js 22 запускает корневые `typecheck`, `lint`, `format:check`, `test` и `build` для workspaces `server` и `web`.
- Repository ruleset (или эквивалент) делает этот status check обязательным для слияния в `main` без обхода администратором; создаётся через `gh api` на apply, не лежит в git.
- ESLint 9 flat config с typescript-eslint type-checked strict (включая запрет explicit `any` и unsafe-any семейство), для `web` — react-hooks recommended; в конце цепочки `eslint-config-prettier`. Корневой скрипт `lint`. Существующий скелет доводится до lint-clean в apply.
- Prettier: корневые `format` и `format:check` для TS/TSX/CSS/JSON под `server/` и `web/`, workflow YAML и корневых конфигов, которыми владеет Prettier. Markdown под `docs/`, `openspec/` и `mcp-gateway-spec.md` не переформатируется.
- Скиллы и агенты (`backend`, `frontend`, `developer`, `validator`, `code-review`, `docs/workflow.md`, guidance apply в `openspec/config.yaml`) узнают lint/format check и правило «no explicit any».

Расширение относительно текста этапа 2 в roadmap: ESLint, Prettier, обновление агентов/скиллов и явный план ruleset через `gh` (не только workflow-файл).

## Non-goals

- Deploy / CD, релизы, Dependabot, пороги coverage, обязательные pre-commit/Husky (CI — единственный обязательный gate).
- Переформатирование Markdown в `docs/`, `openspec/` и `mcp-gateway-spec.md`.
- Поведение продукта шлюза (маршруты, коннекторы, UI).
- Правки `mcp-gateway-spec.md` и `openspec/specs/` вне archive этого изменения.
- Правки сгенерированных скиллов `openspec-*`.

## Capabilities

### New Capabilities

- `pull-request-checks`: контракт репозиторных проверок — workflow на PR в `main` (Node 22, typecheck/lint/format check/test/build), отказ ESLint на explicit `any` в `server` и `web`, поведение `format:check` на отформатированном и сломанном фрагменте. Обязательный ruleset на GitHub — в design/tasks, не в delta-сценариях.

### Modified Capabilities

- (нет — `process-startup` не меняется; стартовое поведение процесса то же)

## Impact

- Новый `.github/workflows/*.yml`, корневые зависимости и скрипты ESLint/Prettier, конфиги ignore.
- Правки скелета `server/` / `web/` только чтобы пройти lint/format (apply).
- Автотесты Vitest на содержимое workflow и на контракт ESLint/Prettier без вызовов GitHub API.
- Обновление проектных скиллов/агентов и `docs/workflow.md` / `openspec/config.yaml` (apply guidance).
- Вне git: repository ruleset на GitHub (создаёт developer через `gh api` на apply; validator подтверждает через `gh`).
