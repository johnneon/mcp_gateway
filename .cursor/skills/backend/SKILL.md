---
name: backend
description: Implements and tests the MCP Gateway server on Node.js, TypeScript, and Express 5 — MCP Streamable HTTP, the encrypted JSON store, configurations, the admin API, the connector contract, and connector modules. Use when editing or testing anything in server/.
---

# Backend

One process. Server code lives in `server/`. Behavior comes from the accepted change delta, not from this skill. This skill says how to build it.

## Frame

- Node.js 22, TypeScript in strict mode, ES modules.
- Express 5 for both listeners. `@modelcontextprotocol/sdk` with the Streamable HTTP transport mounted on `/mcp`. No separate SSE endpoint.
- `zod` for validation of admin API bodies, tool arguments, and the decrypted state file.
- All state is one JSON file in the data directory from the environment, encrypted whole with AES-GCM (`node:crypto`). The key comes only from the environment.
- Load the file at start and keep state in memory. Write through a temp file and rename. Serialize writes.
- If the file cannot be decrypted or parsed, exit non-zero with a reason that contains no key and no content.
- If a required environment variable is missing, exit non-zero and print the variable name. Do not print the value.
- `GET /health` requires no authentication. The body contains no data directory and no secrets.

## Layout

```text
server/
  src/
    main.ts              env → deps → two listeners; the only place that reads process.env
    env.ts               parse and check environment variables
    store/               encryption, file store, state schema
    configurations/      service.ts, routes.ts, token.ts
    accounts/            service.ts, routes.ts
    connectors/
      contract.ts        Connector types
      registry.ts        static list of connectors in code
      native/            runtime for native connectors
      proxy/             runtime for proxy connectors (stdio child processes)
      <id>/              one folder per connector
    mcp/                 bearer auth, tools/list builder, tools/call dispatcher
    http/                createMcpApp, createAdminApp, error mapping, JSON-only guard
  test/                  mirrors src/
```

Create a folder only when a change needs it.

## Architecture

- **Routes** handle HTTP only: parse with `zod`, call a service, map the result to a status code. No business logic in a route.
- **Services** hold the logic. They do not import Express and do not read `process.env`.
- **Store and connectors** are the only code that touches the disk or the network.
- Wire dependencies with factory functions: `createAccountService({ store, registry })`. No DI container, no module-level singletons, no global mutable state. Tests build the same graph with fakes.
- `createMcpApp(deps)` and `createAdminApp(deps)` return Express apps without calling `listen`. `main.ts` listens.
- Domain errors are typed classes (`NotFoundError`, `ValidationError`, `ForbiddenAccountError`). One mapper turns them into HTTP responses, one into MCP errors. Unknown errors become a generic message; their text never reaches the client.
- Logs go to stdout and never include secret values, the raw bearer, or request and response bodies.

## Access boundary

- The MCP port serves `/mcp` and `/health`; everything else is 404. The admin port serves `/api/*` and the static `web` build.
- MCP uses `Authorization: Bearer`. The store keeps only the SHA-256 hash of the token. Compare with `crypto.timingSafeEqual`.
- An empty, unknown, or disabled token gets the same rejection, with no configuration list.
- The admin API has no login. It accepts mutations only with `Content-Type: application/json` and sends no CORS headers.

## Connector

A connector is a code module added by a specific change. It declares an id, a name, account fields (`text`, `secret`, `host`), a connection check, allowed hosts, and a kind. It is registered in `connectors/registry.ts`.

- Tool names are `<connector id>_<name>`. The gateway adds the required `account` parameter; the connector does not.
- Model arguments contain no URL, host, or secret. A foreign or disabled account is rejected before the connector runs.
- A secret is decrypted only in memory and passed only to the connector. The MCP response, the MCP error, and the admin API do not contain it. Scrub secret values from connector output.
- Timeout and response size limit are constants in code. The client error is short, in English, and contains no provider headers or body.

`native`:

- The handler reaches the network only through a client limited to the allowed hosts. Do not follow a redirect to another host.

`proxy`:

- stdio only. The server package is pinned to an exact version in dependencies. Do not download at runtime.
- One child process per account, started on first call, stopped after idle, restarted on the next call after a crash.
- Build the child environment from scratch: mapped account fields plus the minimum to run. Never pass the gateway environment.
- Expose only allowlisted tools. Strip `account` before forwarding. Do not return child stderr to the client.

Do not add a runtime connector catalog or arbitrary HTTP built from model arguments.

## Testing

Write the tests in the same task as the code. Scenario coverage rules are in the `tests` skill.

- Vitest. Files `server/test/**/<name>.test.ts`, mirroring `src/`.
- **Services**: unit tests with a store in a temp directory (`fs.mkdtemp`) and fake connectors. No Express.
- **Admin API**: `supertest` against `createAdminApp(deps)`. Check status codes, the JSON-only guard, and that secret fields are absent from every response.
- **MCP**: start `createMcpApp(deps)` on port 0 and connect with the SDK `Client` and `StreamableHTTPClientTransport`. Check `tools/list` and `tools/call` the way a real client sees them.
- **Store**: round trip, no plaintext on disk, wrong key and corrupt file stop startup.
- **Connectors**: a fake provider counts connections. A rejection is proven when the count stays 0. A `proxy` fake is a small MCP server over stdio that can report the environment it received.
- Pass the clock, random token source, and timeouts through deps so tests control them. No real sleeps.
- Each test creates its own state. No order dependence and no shared data directory.

Commands: `npm test -w server`, `npm run typecheck -w server`.
