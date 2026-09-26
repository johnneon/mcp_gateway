# Design

## Context

См. `proposal.md` — Why. Сейчас: npm workspaces `server`/`web`, корневые скрипты `typecheck` / `test` / `build` / `start`, capability `process-startup`. Каталога `.github/workflows/` нет. ESLint и Prettier не подключены. Скиллы `backend`/`frontend` и агенты требуют только tests / typecheck / build. Обязательность merge на GitHub не задана файлом в git — только ruleset/branch protection на стороне GitHub.

## Goals / Non-Goals

**Goals:**

- Один workflow на PR в `main`: Node 22, `npm ci`, затем typecheck → lint → format:check → test → build.
- Один корневой ESLint 9 flat config на `server/` и `web/`; Prettier владеет форматированием через `eslint-config-prettier` последним в цепочке.
- Корневые `lint`, `format`, `format:check`; CI и агенты вызывают их с корня.
- Ruleset на GitHub делает check обязательным без admin bypass; создание через `gh api` на apply.
- Сценарии delta покрыты Vitest без GitHub API; ruleset — задача + проверка validator через `gh`.

**Non-Goals (уровень дизайна):**

- Husky / pre-commit как обязательный gate.
- Coverage thresholds, matrix ОС, кэш npm сверх разумного минимума Actions.
- Переформатирование Markdown vision/docs/openspec.
- Изменение runtime-поведения процесса.

## Decisions

### 1. Имя workflow и status check

- Файл: `.github/workflows/ci.yml`.
- `on.pull_request.branches: [main]`.
- Один job с именем `checks` (отображаемое имя status check — `checks`, либо полное `ci / checks` в зависимости от того, как GitHub именует check из `jobs.<id>` и имени workflow). Финальное имя check для ruleset фиксируется после первого успешного прогона на ветке изменения и записывается в задачу ruleset.
- `actions/setup-node@v4` с `node-version: '22'`, `cache: npm`.
- Шаги: `npm ci`; `npm run typecheck`; `npm run lint`; `npm run format:check`; `npm test`; `npm run build`.
- Permissions по минимуму (`contents: read`).

**Альтернатива:** отдельные jobs на lint/test — отклонена: один required check проще для ruleset и агентов.

### 2. ESLint: один корневой flat config

- Зависимости в корневом `package.json` (devDependencies): `eslint`, `typescript-eslint`, `eslint-config-prettier`, `eslint-plugin-react-hooks`, при необходимости `@eslint/js`.
- Файл `eslint.config.js` (или `.mjs`) в корне: `typescript-eslint` configs с `strictTypeChecked` (или эквивалент type-checked strict), parserOptions.projectService / project на tsconfig `server` и `web`.
- Правило `@typescript-eslint/no-explicit-any`: `error` везде, включая тесты. Не отключать и не ослаблять в overrides для `**/*.test.*`.
- Семейство unsafe-any из strict type-checked оставить включённым (`no-unsafe-argument`, `no-unsafe-assignment`, `no-unsafe-call`, `no-unsafe-member-access`, `no-unsafe-return`).
- Для файлов под `web/`: добавить `eslint-plugin-react-hooks` recommended.
- Последний элемент цепочки: `eslint-config-prettier`.
- Ignores: `**/dist/**`, `**/node_modules/**`, coverage, lockfile при необходимости.
- Скрипт `"lint": "eslint ."` (или явные пути `server` `web`), один вход для CI и агентов.
- Apply доводит текущий скелет до lint-clean; это отдельная задача, не «оставить долг».

**Альтернатива:** два конфига в packages — отклонена; человек предпочёл один корневой.

### 3. Prettier

- Зависимость `prettier` в корне.
- Конфиг: `.prettierrc` / `prettier.config.*` с разумными дефолтами проекта (без спора о стиле Markdown — Markdown вне scope).
- Ignore: `.prettierignore` — `package-lock.json`, `dist`, `node_modules`, `docs/**`, `openspec/**`, `mcp-gateway-spec.md`, прочие генерируемые артефакты.
- Include: `server/**/*.{ts,tsx,css,json}`, `web/**/*.{ts,tsx,css,json}`, `.github/workflows/*.{yml,yaml}`, корневые конфиги которые Prettier должен владеть (`package.json`, eslint/prettier/tsconfig по необходимости).
- Скрипты: `"format": "prettier --write …"`, `"format:check": "prettier --check …"`.
- Не включать Husky.

### 4. Автотесты сценариев (без GitHub)

Размещение: предпочтительно `server/test/` (уже есть Vitest) или небольшой корневой/server набор — решение при apply: если тесты читают файлы репозитория и вызывают ESLint/Prettier API, логично держать их в `server/test/ci/` или аналогично, чтобы `npm test -w server` их подхватил. Альтернатива — отдельный корневой vitest только если workspaces мешают; по умолчанию не плодить третий runner.

- Workflow: читать `.github/workflows/ci.yml` (yaml parse), assert triggers, node 22, наличие команд скриптов.
- ESLint: временный файл/snippet через ESLint API или `spawn` eslint с конфигом проекта; assert rule id.
- Prettier: temp snippet + `format:check` / prettier check; assert exit codes.

Не писать сценарий «merge blocked on GitHub».

### 5. Repository ruleset через `gh api` (не в git)

Workflow сам по себе merge не блокирует. На apply developer:

1. Убеждается, что на ветке изменения хотя бы раз успешно отработал check (или использует известное имя job после merge workflow в ветку и push для пробного PR / `workflow_dispatch` не требуется — достаточно имени из YAML: для ruleset GitHub принимает имя check, которое появится на PR; зафиксировать в задаче ожидаемое имя `checks` / `ci / checks` и сверить через `gh`).
2. Создаёт ruleset на ветку `main` через GitHub API (`gh api` REST: repository rulesets), параметры:
   - target: branch `main` (include `refs/heads/main`);
   - enforcement: `active`;
   - required status checks: тот check из workflow;
   - `strict_required_status_checks_policy`: true (ветка актуальна относительно base, если применимо);
   - **нет обхода админом**: `bypass_actors` пустой / не включать organization admin bypass; в UI-терминах — «Do not allow bypassing» / отсутствие bypass для admins.
3. Кто выполняет: **developer-агент на шаге apply** (задача в `tasks.md`), с `gh` авторизованным под владельцем/админом репо с правом править rulesets. Если `gh api` возвращает 403/404 или ruleset не создаётся — **apply останавливается и сообщает человеку**: нужны права на rulesets и повтор задачи; не оставлять «нажмите в UI» единственным планом без указания, что UI — запасной путь только если человек сам выполнит тот же контракт ruleset, а агент зафиксировал блокер.
4. Validator после apply подтверждает наличие active ruleset и required check через `gh api`/`gh ruleset` (не через Vitest).

Ruleset не коммитится. Delta-сценария на «live merge» нет.

**Альтернатива:** классический branch protection API — допустима, если rulesets недоступны на плане репо; prefer rulesets. При невозможности обоих — стоп и отчёт человеку.

### 6. Обновление агентов и скиллов (только apply)

Точечно, где уже есть чеклист или агент иначе пропустит lint/format:

| Путь | Что добавить |
| --- | --- |
| `.cursor/skills/backend/SKILL.md` | команды lint/format check для `server/`; правило no explicit `any` |
| `.cursor/skills/frontend/SKILL.md` | то же для `web/` |
| `.cursor/agents/developer.md` | в apply: lint и format check рядом с tests/typecheck/build |
| `.cursor/agents/validator.md` | запуск lint и format check; строки в шаблоне Checks |
| `docs/workflow.md` | bullet apply называет lint и format check |
| `.cursor/skills/code-review/SKILL.md` | blocker: новый/изменённый файл с explicit `any` или нарушением ESLint/Prettier контракта; обычные style notes — не blockers |
| `openspec/config.yaml` | apply guidance: lint и format check рядом с tests/typecheck/build |

Не трогать сгенерированные `openspec-*` skills, `mcp-gateway-spec.md`, `openspec/specs/` до archive.

## Risks / Trade-offs

- [Имя status check в UI ≠ `jobs.<id>`] → Mitigation: после первого прогона сверить через `gh` и прописать точное имя в ruleset; задача ruleset после workflow.
- [Строгий type-checked ESLint ломает скелет] → Mitigation: отдельная задача «lint-clean»; не ослаблять `any`/unsafe.
- [Нет прав на ruleset у токена агента] → Mitigation: apply стоп + отчёт; человек выдаёт права или создаёт эквивалентный ruleset сам по контракту из design; validator проверяет факт.
- [Тесты ESLint/Prettier хрупки к путям temp] → Mitigation: писать snippet под `server/`/`web` ignore-исключениями для temp или `overrideConfig` с теми же rules.

## Migration Plan

Чистое добавление tooling и workflow. Откат: revert коммитов изменения + удаление ruleset через `gh api` (задача человека/агента при откате). Данных продукта нет.

## Open Questions

- Точное отображаемое имя required check (`checks` vs `ci / checks`) — закрывается на apply после первого run Actions; на specs не влияет.
- Если GitHub Free/права организации запрещают rulesets без bypass — зафиксировать blocker человеку; обход «только UI без `gh`» не считается выполненной задачей агента.
