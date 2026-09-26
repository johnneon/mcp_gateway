# Spec Delta

## Purpose

Задаёт репозиторный контракт проверок перед слиянием в `main`: содержимое GitHub Actions workflow, отказ ESLint на explicit `any` и поведение Prettier `format:check` — всё проверяемое локально без вызовов GitHub API.

## ADDED Requirements

### Requirement: Workflow на pull_request в main

Репозиторий SHALL содержать файл GitHub Actions workflow, который запускается на событии `pull_request` с целевой веткой `main`. Job SHALL использовать Node.js версии 22. После установки зависимостей job SHALL выполнить корневые скрипты `typecheck`, `lint`, `format:check`, `test` и `build` (в любом порядке, согласованном с design). Workflow-файл SHALL лежать под `.github/workflows/`.

#### Scenario: Workflow объявляет Node 22 и все проверки

- **GIVEN** в репозитории есть workflow-файл под `.github/workflows/` для pull request в `main`
- **WHEN** тест читает этот файл (без вызова GitHub API)
- **THEN** триггер включает `pull_request` на ветку `main`
- **AND** в job указана версия Node.js `22`
- **AND** шаги включают выполнение корневых скриптов `typecheck`, `lint`, `format:check`, `test` и `build`

### Requirement: ESLint отвергает explicit any в server и web

Корневая конфигурация ESLint SHALL считать `@typescript-eslint/no-explicit-any` ошибкой для исходников и тестов под `server/` и под `web/`. Запуск ESLint (CLI или API) на фрагменте TypeScript с явным типом `any` SHALL завершаться с ошибкой по этому правилу. Escape hatch, отключающий запрет `any` для всего проекта или для тестов по умолчанию, SHALL NOT быть частью конфигурации.

#### Scenario: Explicit any в server-фрагменте — ошибка

- **GIVEN** корневая ESLint-конфигурация проекта загружена
- **WHEN** ESLint проверяет временный TypeScript-фрагмент с путём как у `server/` (например под `server/`) и с явным типом `any`
- **THEN** результат содержит ошибку правила `@typescript-eslint/no-explicit-any`
- **AND** код выхода проверки ненулевой (или API сообщает failure)

#### Scenario: Explicit any в web-фрагменте — ошибка

- **GIVEN** корневая ESLint-конфигурация проекта загружена
- **WHEN** ESLint проверяет временный TypeScript-фрагмент с путём как у `web/` (например под `web/`) и с явным типом `any`
- **THEN** результат содержит ошибку правила `@typescript-eslint/no-explicit-any`
- **AND** код выхода проверки ненулевой (или API сообщает failure)

### Requirement: format:check различает сломанный и нормальный фрагмент

Корневой скрипт `format:check` SHALL завершаться с ненулевым кодом на фрагменте TypeScript (или ином включённом в Prettier типе файла под `server/` / `web/`), который нарушает правила форматирования Prettier проекта, и SHALL завершаться с нулевым кодом на том же фрагменте после форматирования по тем же правилам. Проверка SHALL выполняться локально через Prettier/npm-скрипт без вызова GitHub.

#### Scenario: format:check падает на сломанном фрагменте

- **GIVEN** во временном каталоге под путём, который покрывает Prettier проекта (например под `server/` или `web/`), лежит файл с намеренно сломанным форматированием
- **WHEN** запускается корневой `format:check` (или эквивалентный вызов Prettier check с конфигом проекта) на этом фрагменте
- **THEN** код выхода ненулевой

#### Scenario: format:check проходит на отформатированном фрагменте

- **GIVEN** тот же фрагмент отформатирован правилами Prettier проекта (например через `format` / Prettier write)
- **WHEN** снова запускается `format:check` (или эквивалентный Prettier check) на этом фрагменте
- **THEN** код выхода нулевой
