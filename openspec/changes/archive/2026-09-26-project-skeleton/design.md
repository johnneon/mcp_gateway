# Design

## Context

See `proposal.md` — Why. Right now the repository has only a root `package.json` (devDependency openspec), `openspec/`, documentation, and skills. There are no `server/` or `web/` directories. `openspec/specs/` is empty. Vision: `mcp-gateway-spec.md` ("Stack", "Environment", "Repository build"). The base order was task 1.1 in the former `docs/implementation.md`. Server and frontend layout follow the `backend` and `frontend` skills: create a folder only when a change needs it.

## Goals / Non-Goals

**Goals:**

- npm workspaces: `server` and `web`, ES modules, TypeScript strict.
- One process: `env` → apps → two `listen` calls.
- Fixed variable names and the rule "the name, not the value".
- A minimal admin shell plus serving `web` dist from the admin port.
- typecheck / test / build scripts at the root and in the workspaces.
- Every delta scenario is a Vitest test with no external services.

**Non-Goals (design level):**

- Implementing the store, the `/health` body, and a hard split of MCP/admin routes (1.2–1.4).
- Mounting Streamable HTTP `/mcp` can wait if the outcome of this change is "the process listens"; the package `@modelcontextprotocol/sdk` is still declared as a dependency.
- Radix and `shared/ui` only if the shell actually needs a primitive; otherwise do not pull them in.

## Decisions

### 1. Environment variable names (closes the open question from the former implementation notes)

| Name | Role | Required |
| --- | --- | --- |
| `MCP_HOST` | MCP bind | required |
| `MCP_PORT` | MCP port | required (number) |
| `ADMIN_HOST` | admin UI/API bind | optional; default `127.0.0.1` |
| `ADMIN_PORT` | admin port | required (number) |
| `DATA_DIR` | data directory | required (even without a store) |
| `ENCRYPTION_KEY` | AES-GCM key | required (even without a store) |

**Decision on `ADMIN_HOST`:** if the variable is missing or an empty string, use `127.0.0.1`. It is not in the list of missing required variables. This follows the specification ("default address `127.0.0.1`"), not the option "always set it explicitly".

**Alternative:** require all six explicitly — rejected, because it contradicts the defaults in the vision.

An empty string on a required variable counts as missing. The error message is only the name (for example `MCP_HOST`), with no values and no environment dump. Exit code is not 0.

### 2. Who reads `process.env`

Only `server/src/main.ts` reads `process.env` and passes the raw object (or a slice of it) to `parseEnv` in `server/src/env.ts`. The rest of the code receives an already parsed config through factory arguments. Tests call `parseEnv` with a stand-in object and start the apps without the real `process.env` where that is possible. "Process start" scenarios use spawn with a controlled env.

### 3. Package structure

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
  test/               mirrors the scenarios
web/
  package.json
  tsconfig.json
  vite.config.ts      alias @ → src
  vitest.config.ts
  index.html
  src/
    app/              entry, minimal layout, tokens/reset if needed
```

Do not create in this change: `store/`, `configurations/`, `accounts/`, `connectors/`, `mcp/`, or the Configurations/Connectors screens.

`createMcpApp` / `createAdminApp` return Express apps **without** `listen`. `main.ts` calls `listen` on both.

Admin app: `express.static` on the `web` production build directory (the path is fixed relative to the monorepo layout / `import.meta.url`). The MCP app in this change may be an empty Express app (or a minimal stub); route limits are task 1.4.

### 4. Workspaces, modules, scripts

- `"type": "module"` at the root and/or in the packages.
- Root scripts delegate: `typecheck`, `test`, `build` (and `start` → `server` if needed).
- `server`: Express 5, zod (for ports/env strings), `@modelcontextprotocol/sdk` in dependencies (mounting it as needed), Vitest, TypeScript.
- `web`: React, React DOM, Vite, TypeScript, Vitest; CSS modules. Do not add Radix while the shell can do without it.
- Build: `web` first (vite build), then `server` (tsc or an agreed method), so admin can serve dist.

### 5. Testing the scenarios

- Unit: `parseEnv` — each required variable missing; default `ADMIN_HOST`; values do not appear in the error message (the test supplies a recognizable secret and checks it is absent from the error text).
- Integration: spawn `node` on the built/tsx entry with a temp env and free ports; TCP connect to both listeners; HTTP GET `/` on admin → HTML.
- No live external services and no real encryption key beyond the test sample.

### 6. Depending on DATA_DIR / ENCRYPTION_KEY without a store

`parseEnv` checks that they are present and keeps them in the config. The store is not opened. The directory may not exist — creating the state file is not part of this change. The goal is to fix the environment contract before task 1.2.

## Risks / Trade-offs

- [Empty MCP app until `/mcp` is mounted] → Mitigation: the sdk dependency is declared; the delta does not require the MCP protocol in this change, only the listener.
- [The path to `web/dist` is fragile in the monorepo] → Mitigation: one agreed path in design/tasks, checked by the GET `/` test.
- [Spawn tests are slower than units] → Mitigation: env logic stays in units; spawn covers listener and HTML scenarios.
- [ADMIN_HOST optional vs "all six names"] → Mitigation: all six names are fixed in the table; five are required plus a default for the admin host — stated in the spec and here.

## Migration Plan

A pure addition of the skeleton. Rollback is deleting the branch / reverting the change's commits. There is no data migration.

## Open Questions

None blocking. The environment names that were open earlier are closed by decision 1.
