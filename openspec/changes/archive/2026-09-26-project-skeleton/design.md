# Design

## Context

См. `proposal.md` — Why. Сейчас в репозитории только корневой `package.json` (devDependency openspec), `openspec/`, документация и скиллы. Каталогов `server/` и `web/` нет. `openspec/specs/` пуст. Vision: `mcp-gateway-spec.md` («Стек», «Окружение», «Сборка репозитория»), порядок базы — `docs/implementation.md` §1 задача 1.1. Layout сервера и фронта — скиллы `backend` и `frontend`: создавать папки только когда изменение их требует.

## Goals / Non-Goals

**Goals:**

- npm workspaces: `server` и `web`, ES modules, TypeScript strict.
- Единый процесс: `env` → apps → два `listen`.
- Зафиксированные имена переменных и правило «имя, не значение».
- Минимальный admin shell + раздача `web` dist с admin-порта.
- Скрипты typecheck / test / build на корне и в workspaces.
- Каждый сценарий delta — автотест на Vitest без внешних сервисов.

**Non-Goals (уровень дизайна):**

- Реализация store, `/health` body, жёсткое разделение маршрутов MCP/admin (1.2–1.4).
- Монтирование Streamable HTTP `/mcp` можно отложить, если исход изменения — «процесс слушает»; пакет `@modelcontextprotocol/sdk` всё равно объявить в зависимостях.
- Radix и `shared/ui` — только если оболочке реально нужен примитив; иначе не тянуть.

## Decisions

### 1. Имена переменных окружения (закрытие [ПОД ВОПРОСОМ] из implementation.md)

| Имя | Роль | Обязательность |
| --- | --- | --- |
| `MCP_HOST` | bind MCP | обязательна |
| `MCP_PORT` | порт MCP | обязательна (число) |
| `ADMIN_HOST` | bind admin UI/API | опциональна; по умолчанию `127.0.0.1` |
| `ADMIN_PORT` | порт admin | обязательна (число) |
| `DATA_DIR` | каталог данных | обязательна (даже без store) |
| `ENCRYPTION_KEY` | ключ AES-GCM | обязательна (даже без store) |

**Решение по `ADMIN_HOST`:** если переменная отсутствует или пустая строка — использовать `127.0.0.1`. В списке «недостающая обязательная переменная» её нет. Это следует спецификации («адрес по умолчанию `127.0.0.1`»), а не варианту «всегда задавать явно».

**Альтернатива:** требовать все шесть явно — отклонена: противоречит defaults в vision.

Пустая строка у обязательной переменной = отсутствие. Сообщение об ошибке: только имя (например `MCP_HOST`), без значений и без дампа окружения. Код выхода ≠ 0.

### 2. Кто читает `process.env`

Только `server/src/main.ts` читает `process.env` и передаёт сырой объект (или его срез) в `parseEnv` из `server/src/env.ts`. Остальной код получает уже разобранный конфиг через аргументы фабрик. Тесты вызывают `parseEnv` с подставным объектом и поднимают apps без реального `process.env`, где это возможно; сценарии «запуск процесса» — через spawn с контролируемым env.

### 3. Структура пакетов

```text
package.json          workspaces: ["server", "web"]
server/
  package.json
  tsconfig.json
  vitest.config.ts
  src/
    main.ts           parseEnv → createMcpApp / createAdminApp → listen
    env.ts            parseEnv(env): EnvConfig | throws MissingEnvError
    http/
      createMcpApp.ts
      createAdminApp.ts
  test/               зеркало сценариев
web/
  package.json
  tsconfig.json
  vite.config.ts      alias @ → src
  vitest.config.ts
  index.html
  src/
    app/              entry, минимальный layout, tokens/reset при необходимости
```

Не создавать в этом изменении: `store/`, `configurations/`, `accounts/`, `connectors/`, `mcp/`, экраны Configurations/Connectors.

`createMcpApp` / `createAdminApp` возвращают Express apps **без** `listen`. `main.ts` вызывает `listen` на обоих.

Admin app: `express.static` на каталог production-сборки `web` (путь фиксируется относительно layout монорепо / `import.meta.url`). MCP app в этом изменении может быть пустым Express (или минимальным stub); ограничение маршрутов — задача 1.4.

### 4. Workspaces, модули, скрипты

- `"type": "module"` в корне и/или в пакетах.
- Корневые скрипты делегируют: `typecheck`, `test`, `build` (и при необходимости `start` → `server`).
- `server`: Express 5, zod (для портов/строк env), `@modelcontextprotocol/sdk` в dependencies (использование mount — по мере нужды), Vitest, TypeScript.
- `web`: React, React DOM, Vite, TypeScript, Vitest; CSS modules. Radix — не добавлять, пока shell обходится без него.
- Сборка: сначала `web` (vite build), затем `server` (tsc или согласованный способ), чтобы admin мог раздавать dist.

### 5. Тестирование сценариев

- Юнит: `parseEnv` — отсутствие каждой обязательной переменной; default `ADMIN_HOST`; значения не попадают в сообщение об ошибке (в тест подставляется узнаваемый секрет и проверяется отсутствие в тексте ошибки).
- Интеграция: spawn `node` на собранный/tsx entry с temp env и свободными портами; TCP connect к обоим слушателям; HTTP GET `/` на admin → HTML.
- Без живых внешних сервисов и без реального ключа шифрования вне тестового образца.

### 6. Зависимость от DATA_DIR / ENCRYPTION_KEY без store

`parseEnv` проверяет наличие и сохраняет в конфиге. Store не открывается. Каталог может не существовать — создание файла состояния не входит в изменение. Цель: контракт окружения зафиксирован до задачи 1.2.

## Risks / Trade-offs

- [Пустой MCP app до mount `/mcp`] → Mitigation: зависимость sdk объявлена; delta не требует MCP protocol в этом изменении, только слушатель.
- [Путь к `web/dist` хрупкий в monorepo] → Mitigation: один согласованный путь в design/tasks, проверка в тесте GET `/`.
- [Тесты через spawn медленнее юнитов] → Mitigation: логика env в юнитах; spawn — на сценарии слушателей и HTML.
- [ADMIN_HOST optional vs «все шесть имён»] → Mitigation: все шесть имён зафиксированы в таблице; обязательны пять плюс default для admin host — явно в spec и здесь.

## Migration Plan

Чистое добавление каркаса. Откат — удаление ветки / revert коммитов изменения. Миграции данных нет.

## Open Questions

Нет блокирующих. Открытые ранее имена переменных закрыты решением 1.
