# MCP Gateway

Шлюз — MCP-сервер (Streamable HTTP), через который модель работает с внешними сервисами. Учётные данные аккаунтов хранятся в шлюзе; секрет аккаунта модель не получает. Доступ к набору аккаунтов выдаёт bearer-токен конфигурации.

Полная спецификация — в [`mcp-gateway-spec.md`](mcp-gateway-spec.md).

## Стек

Один процесс на Node.js 22 и TypeScript.

- `server` — Express 5, MCP Streamable HTTP (`@modelcontextprotocol/sdk`), admin API, зашифрованное хранилище.
- `web` — React 19 и Vite, shadcn/ui и Tailwind. Отдельного фронтенд-сервиса нет: тот же процесс раздаёт собранную статику.
- Состояние — один JSON-файл, зашифрованный AES-GCM. Ключ только из окружения.
- Тесты — Vitest.

MCP и интерфейс слушают разные порты. На порту MCP доступны только `/mcp` и `/health`.

## Запуск

Нужен Node.js 22 или новее.

```bash
npm install
cp .env.example .env
```

Заполните `.env`. Обязательные переменные: `MCP_HOST`, `MCP_PORT`, `ADMIN_PORT`, `DATA_DIR`, `ENCRYPTION_KEY`. `ADMIN_HOST` необязателен и по умолчанию равен `127.0.0.1`.

`ENCRYPTION_KEY` — стандартный base64, который декодируется ровно в 32 байта:

```bash
openssl rand -base64 32
```

Каталог из `DATA_DIR` должен существовать. Пример для локального запуска:

```bash
mkdir -p data
```

```env
MCP_HOST=127.0.0.1
MCP_PORT=3001
ADMIN_HOST=127.0.0.1
ADMIN_PORT=3000
DATA_DIR=data
ENCRYPTION_KEY=<вывод openssl>
```

Файл `.env` в git не попадает. Процесс читает окружение, а не файл, поэтому передайте его явно:

```bash
npm run build
node --env-file=.env server/dist/main.js
```

Интерфейс — `http://127.0.0.1:3000`. Проверка MCP-порта — `GET http://127.0.0.1:3001/health`.

Если переменная отсутствует, пуста или ключ не подходит по формату, процесс завершается с кодом 1 и пишет в stderr только имя переменной.

## Запуск в контейнере

Нужны Docker и Docker Compose. Образ собирает `web` и `server` и запускает тот же процесс: `node server/dist/main.js`.

Рядом с `docker-compose.yml` положите `.env` с ключом. Compose подставляет из этого файла только `ENCRYPTION_KEY`. Хосты, порты и каталог данных заданы в compose: оба слушателя на `0.0.0.0`, MCP — `3100`, админка — `3200`, данные — `/data`.

```bash
docker compose up -d --build
```

Интерфейс на сервере — `http://127.0.0.1:3200`. Порт админки опубликован только на loopback; снаружи его закрывает прокси. Проверка MCP — `GET http://127.0.0.1:3100/health`.

Данные лежат в томе `gateway-data` и сохраняются при пересоздании контейнера. Для уже заполненного тома нужен тот же `ENCRYPTION_KEY`.

Коннектор вида proxy запускает файл входа через `node` контейнера. Путь, записанный в аккаунте, должен существовать внутри контейнера. В `docker-compose.yml` для этого есть закомментированный том `./proxy:/proxy`.

Проверка типов, тесты и сборка:

```bash
npm run typecheck
npm test
npm run build
```

## Автор

[Efimovich Evgenii](https://github.com/johnneon)
