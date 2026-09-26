# Design

## Context

См. `proposal.md` — Why. Каркас `project-skeleton` уже разбирает окружение (`server/src/env.ts`) и слушает два порта (`server/src/main.ts`) без открытия хранилища: `EnvConfig.encryptionKey` — строка, `DATA_DIR` только сохраняется. Vision: `mcp-gateway-spec.md` («Хранилище», «Окружение»). Текущий контракт старта: `openspec/specs/process-startup/spec.md`. Зависимость `project-skeleton` заархивирована.

## Goals / Non-Goals

**Goals:**

- Один зашифрованный файл состояния, загрузка до `listen`.
- Формат ключа и layout файла зафиксированы и проверяемы автотестами.
- Каталог данных — проектный `data`; `DATA_DIR` обязательна; `data/` в `.gitignore`.
- API `open` / read / `replace` для следующих этапов без доменной модели.
- Ошибки на английском, фиксированный текст, без ключа и без содержимого файла.

**Non-Goals:**

- Конфигурации, аккаунты, bearer hashes, HTTP/UI/MCP поверх store.
- File lock между процессами, ротация ключа, миграция с plaintext.
- Создание `DATA_DIR`, если каталога нет (оператор задаёт существующий каталог; поведение отсутствия каталога не расширяет контракт этого изменения сверх ошибок Node при записи).

## Decisions

Приняты человеком до propose; здесь не переоткрываются.

### 1. Формат ENCRYPTION_KEY

`ENCRYPTION_KEY` — стандартный base64, декодируется ровно в 32 байта (AES-256). Проверка в `parseEnv`. Неверный алфавит или длина ≠ 32: `process.exit(1)`, в stderr только имя `ENCRYPTION_KEY`, без значения. `EnvConfig.encryptionKey` — `Buffer` длиной 32, не исходная строка.

**Альтернатива (отклонена):** hex или сырая строка произвольной длины — хуже для AES-256 и для явной проверки размера.

### 2. Путь файла

`path.join(DATA_DIR, 'state.bin')`. `DATA_DIR` остаётся обязательной переменной окружения и не убирается из контракта старта. Для работающего шлюза `DATA_DIR` указывает на проектный каталог `data` в корне репозитория (рядом с `server/` и `web/`), то есть файл — `data/state.bin`. Временный файл записи — `data/state.bin.tmp` в том же каталоге (`path.join(DATA_DIR, 'state.bin.tmp')`). Автотесты MAY задавать `DATA_DIR` подкаталогом внутри `data/`, чтобы оставаться под gitignore и не перезаписывать локальный `data/state.bin`.

### 3. On-disk layout

| Смещение | Содержимое |
| --- | --- |
| 0 | версия `1` (1 байт) |
| 1–12 | свежий 12-байтный IV на каждую запись |
| 13 … n-17 | AES-256-GCM ciphertext |
| последние 16 | auth tag |

Байт версии — additional authenticated data: смена версии без перешифрования даёт failure тега (`state file cannot be decrypted`), а не «тихую» смену формата.

Реализация: Node.js `crypto` (`createCipheriv` / `createDecipheriv` с `aes-256-gcm`).

### 4. Документ в памяти и появление файла

Документ — JSON-объект. Пустое состояние — `{}`. Старт при отсутствии файла не создаёт `state.bin`. Файл появляется при первом успешном `replace`.

### 5. Запись и очередь

В одном процессе запись сериализована очередью (цепочка промисов / mutex в памяти). `replace`:

1. Пишет `DATA_DIR/state.bin.tmp` в том же каталоге.
2. `fsync` временного файла.
3. `rename` → `state.bin`.
4. Только после успешного rename подменяет документ в памяти.

Неуспешная запись оставляет прежний документ в памяти. Межпроцессный file lock не делается.

### 6. Тексты ошибок (English, fixed)

| Условие | Текст | Когда |
| --- | --- | --- |
| файл короче заголовка; версия ≠ 1; расшифрованные байты не JSON-объект | `state file is corrupt` | до `listen`, exit 1 |
| auth tag failure (чужой ключ или подмена ciphertext) | `state file cannot be decrypted` | до `listen`, exit 1 |

Без ключа и без байт файла в сообщении и в stdout/stderr.

### 7. Store API этого изменения

- `open(dataDir, key)` — загрузка или пустое состояние
- чтение текущего документа
- `replace(document)` — целиком

Без configurations, accounts, HTTP, UI.

### 8. Интеграция в старт и тесты

`main.ts`: `parseEnv` → `open` store → при ошибке store писать фиксированный текст в stderr и `exit(1)` → иначе `listen`. Фикстуры `ENCRYPTION_KEY` в существующих process-startup тестах становятся валидным 32-байтным base64; assert «значение ключа не в stdout/stderr» сохраняется. Тестовый `DATA_DIR` — подкаталог проектного `data/`, не корневой `data/state.bin` оператора.

**Структура (ориентир):**

```text
data/                 DATA_DIR работающего шлюза; в .gitignore как data/
  state.bin
  state.bin.tmp
server/src/
  env.ts              encryptionKey: Buffer; validate base64/length
  store/
    open.ts / store.ts  open, read, replace, queue, codec
  main.ts             parseEnv → open store → listen
server/test/
  env.test.ts         обновить ключ; сценарии неверного формата
  process-startup.*   валидный ключ; отказ store без портов
  store*.test.ts      сценарии encrypted-store
```

### 9. Имя каталога и gitignore

Каталог данных в репозитории называется `data` (не другое имя). В корневом `.gitignore` уже есть строка `data/` — apply проверяет, что она присутствует, и не добавляет второй паттерн. Благодаря этому `state.bin` и `state.bin.tmp` никогда не коммитятся.
## Risks / Trade-offs

- [Нет cross-process lock] → Mitigation: один процесс шлюза по продуктовой модели; зафиксировано в non-goals.
- [Версия в AAD даёт decrypt-ошибку при version≠1 на целом файле с чужим layout] → Mitigation: отдельная проверка длины/версии до decrypt там, где формат явно не `1` или файл слишком короткий → `corrupt`; tag failure остаётся `cannot be decrypted`.
- [Смена типа `encryptionKey` ломает текущие тесты] → Mitigation: delta `process-startup` явно требует новые фикстуры; одна задача на обновление env + spawn-тестов.
- [rename на Windows] → Mitigation: temp в том же каталоге; при необходимости заменить существующий `state.bin` способом, принятым в Node для этой ОС, сохраняя семантику «после успеха — новый документ».

## Migration Plan

Чистое добавление store. Откат — revert коммитов изменения. Данных для миграции нет: раньше файла состояния не было.

## Open Questions

Нет. Решения 1–9 приняты (1–8 до propose; 9 — каталог `data` и существующий gitignore — при ревизии).
