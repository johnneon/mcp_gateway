# Tasks

## 1. Prettier и корневые скрипты format

- [ ] 1.1 Добавить Prettier в корневые devDependencies, конфиг и `.prettierignore` (исключить `package-lock.json`, `dist`, `node_modules`, `docs/**`, `openspec/**`, `mcp-gateway-spec.md`; форматировать TS/TSX/CSS/JSON под `server/` и `web/`, workflow YAML и корневые конфиги по design). Корневые скрипты `format` и `format:check`. Проверка: `npm run format:check` завершается кодом 0 после первичного `format` по включённым путям (без переписывания Markdown docs/openspec).

## 2. ESLint

- [ ] 2.1 Добавить ESLint 9 flat config в корне (typescript-eslint `strictTypeChecked` или эквивалент, `@typescript-eslint/no-explicit-any` error везде включая тесты, unsafe-any семейство включено, для `web/` — `eslint-plugin-react-hooks` recommended, последним — `eslint-config-prettier`; ignores `dist`/`node_modules`/coverage). Корневой скрипт `lint`. Проверка: `npm run lint` запускается (может падать на скелете до задачи 2.2).

- [ ] 2.2 Довести существующий код `server/` и `web/` до lint-clean и format-clean без ослабления `any`/unsafe и без escape hatch на тесты. Проверка: `npm run lint` и `npm run format:check` завершаются кодом 0; `npm run typecheck` проходит.

## 3. GitHub Actions workflow

- [ ] 3.1 Добавить `.github/workflows/ci.yml`: `pull_request` → `main`, Node.js 22, `npm ci`, затем `typecheck`, `lint`, `format:check`, `test`, `build`; job id согласован с design (`checks`). Проверка: файл существует; автотест сценария «Workflow объявляет Node 22 и все проверки» из delta проходит (чтение YAML без GitHub API).

## 4. Автотесты delta

- [ ] 4.1 Автотесты сценариев ESLint: explicit `any` в temp-фрагментах под путями как у `server/` и `web/` даёт ошибку `@typescript-eslint/no-explicit-any` (ESLint API или spawn). Имена тестов включают id требования и имя сценария. Проверка: тесты проходят в `npm test` (workspace по design).

- [ ] 4.2 Автотесты сценариев `format:check`: ненулевой exit на сломанном фрагменте, нулевой — на отформатированном. Проверка: тесты проходят; полный `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build` с корня — код 0.

## 5. Агенты и скиллы

- [ ] 5.1 Обновить только перечисленные файлы: `.cursor/skills/backend/SKILL.md`, `.cursor/skills/frontend/SKILL.md`, `.cursor/agents/developer.md`, `.cursor/agents/validator.md`, `docs/workflow.md`, `.cursor/skills/code-review/SKILL.md`, apply guidance в `openspec/config.yaml` — команды lint/format check, правило no explicit `any`, blocker в code-review, строки Checks у validator. Не трогать `openspec-*` skills, `mcp-gateway-spec.md`, `openspec/specs/`. Проверка: в каждом файле есть упоминание lint и format check (и any/blockers где указано в proposal).

## 6. Repository ruleset (не в git)

- [ ] 6.1 Developer на apply создаёт (или обновляет) active repository ruleset на `main` через `gh api`: required status check = check из workflow (`checks` / уточнённое имя после первого run), без bypass для админов (`bypass_actors` пустой). Если `gh` не авторизован или API отклоняет (403 и т.п.) — **остановиться и сообщить человеку** (нужны права admin/rulesets); не считать задачу выполненной по совету «только клик в UI» без того, кто выполняет эквивалент. Проверка: `gh api` показывает active ruleset на `main` с required check и без admin bypass; validator позже подтверждает тем же способом. Vitest-сценария на live merge нет.
