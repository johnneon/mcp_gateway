# MCP Gateway

The gateway is an MCP server (Streamable HTTP) through which a model works with external services. Account credentials are stored in the gateway; the model never receives an account secret. A configuration bearer token grants access to a chosen set of accounts.

The full specification is in [`mcp-gateway-spec.md`](mcp-gateway-spec.md).

## Stack

One process on Node.js 22 and TypeScript.

- `server` — Express 5, MCP Streamable HTTP (`@modelcontextprotocol/sdk`), admin API, encrypted store.
- `web` — React 19 and Vite, shadcn/ui and Tailwind. There is no separate frontend service: the same process serves the built static files.
- State is one JSON file encrypted with AES-GCM. The key comes only from the environment.
- Tests run on Vitest.

MCP and the UI listen on different ports. The MCP port serves only `/mcp` and `/health`.

## Run

Node.js 22 or newer is required.

```bash
npm install
cp .env.example .env
```

Fill in `.env`. Required variables: `MCP_HOST`, `MCP_PORT`, `ADMIN_PORT`, `DATA_DIR`, `ENCRYPTION_KEY`. `ADMIN_HOST` is optional and defaults to `127.0.0.1`.

`ENCRYPTION_KEY` is standard base64 that decodes to exactly 32 bytes:

```bash
openssl rand -base64 32
```

The directory in `DATA_DIR` must exist. Example for a local run:

```bash
mkdir -p data
```

```env
MCP_HOST=127.0.0.1
MCP_PORT=3001
ADMIN_HOST=127.0.0.1
ADMIN_PORT=3000
DATA_DIR=data
ENCRYPTION_KEY=<openssl output>
```

`.env` is not committed. The process reads the environment, not the file, so pass it explicitly:

```bash
npm run build
node --env-file=.env server/dist/main.js
```

The UI is `http://127.0.0.1:3000`. The MCP port check is `GET http://127.0.0.1:3001/health`.

If a variable is missing, empty, or the key has the wrong format, the process exits with code 1 and writes only the variable name to stderr.

Type check, tests, and build:

```bash
npm run typecheck
npm test
npm run build
```

## Run in a container

Docker and Docker Compose are required. The image builds `web` and `server` and starts the same process: `node server/dist/main.js`.

Put a `.env` with the key next to `docker-compose.yml`. Compose substitutes only `ENCRYPTION_KEY` from that file. Hosts, ports, and the data directory are set in compose: both listeners on `0.0.0.0`, MCP on `3100`, admin on `3200`, data in `/data`.

```bash
docker compose up -d --build
```

On the server the UI is `http://127.0.0.1:3200`. The admin port is published only on loopback; a proxy in front of it protects it from the outside. The MCP check is `GET http://127.0.0.1:3100/health`.

Data lives in the `gateway-data` volume and survives container recreation. An existing volume needs the same `ENCRYPTION_KEY`.

A `proxy` connector runs its entry file with the container's `node`. The path stored on the account must exist inside the container. `docker-compose.yml` has a commented volume `./proxy:/proxy` for that.

## Author

[Efimovich Evgenii](https://github.com/johnneon)
