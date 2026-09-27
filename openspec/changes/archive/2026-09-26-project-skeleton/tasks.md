# Tasks

## 1. Workspaces and packages

- [x] 1.1 Set up npm workspaces in the root `package.json` (`server`, `web`), ES modules, and scripts `typecheck` / `test` / `build` / `start`. Create `server/package.json` and `web/package.json` with the dependencies from design (Express 5, `@modelcontextprotocol/sdk`, zod, Vitest, TypeScript on server; React, Vite, Vitest, TypeScript on web; no Radix while the shell does not need it). Check: `npm install` finishes without error and the lockfile has the workspaces.

- [x] 1.2 Add TypeScript strict and Vitest/Vite configs for both packages (`tsconfig`, `vitest.config`, `vite.config` with alias `@` → `web/src`), and minimal entry stubs so `typecheck` does not fail on an empty tree. Check: `npm run typecheck` passes.

## 2. Environment

- [x] 2.1 Implement `server/src/env.ts` (`parseEnv`): required `MCP_HOST`, `MCP_PORT`, `ADMIN_PORT`, `DATA_DIR`, `ENCRYPTION_KEY`; `ADMIN_HOST` defaults to `127.0.0.1`; an empty string counts as missing; the error contains only the variable name. Automated tests for the delta scenarios "Missing MCP_HOST|MCP_PORT|ADMIN_PORT|DATA_DIR|ENCRYPTION_KEY" and the `ADMIN_HOST` default (a unit test on a stand-in env object, without printing values). Check: `npm test -w server` covers these scenarios and passes.

## 3. HTTP apps and the entry point

- [x] 3.1 Implement `server/src/http/createMcpApp.ts` and `createAdminApp.ts` (Express apps without `listen`; admin serves the static production build of `web`), and `server/src/main.ts` (the only read of `process.env` → parseEnv → apps → two listens; on MissingEnv, print the name and `process.exit(1)`). Check: the modules compile and `npm run typecheck -w server` passes.

- [x] 3.2 Automated tests for "Both listeners accept a connection", "ADMIN_HOST is unset" / "set explicitly", and "Admin root returns the shell HTML": spawn the process with a controlled env, TCP connect, HTTP GET `/` on admin after `npm run build -w web`. Check: the tests pass; stdout/stderr of a successful start do not contain the `ENCRYPTION_KEY` or `DATA_DIR` values.

## 4. Web shell

- [x] 4.1 A minimal React + CSS modules shell in `web/src/app/` (English text, no Configurations/Connectors screens), `index.html`, and a Vite build into dist. A component or smoke test of the shell per `frontend-cover-tests` as needed. Check: `npm test -w web` and `npm run build -w web` pass; dist contains HTML/JS.

## 5. Root check

- [x] 5.1 Bring the root scripts to the point where `npm run typecheck`, `npm test`, and `npm run build` pass as a whole. If needed, `.env.example` lists variable names only (no secret values). Check: the three commands from the root exit 0.
