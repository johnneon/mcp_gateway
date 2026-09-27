# Proposal

## Why

The repository has only a root `package.json` with OpenSpec and no runnable application. Without a workspace skeleton, declared dependencies, and a process on two addresses, the process-and-store epic and later changes cannot be built or checked.

## What Changes

- The repository becomes an npm-workspaces application: packages `server/` and `web/`, and root scripts for typecheck, test, and build.
- `server/` gains an entry point: environment parsing, two Express apps (MCP and admin), and `listen` on both addresses.
- Environment variable names are fixed: `MCP_HOST`, `MCP_PORT`, `ADMIN_HOST`, `ADMIN_PORT`, `DATA_DIR`, `ENCRYPTION_KEY`. If a required variable is missing, the process exits non-zero and prints only the variable name.
- When `ADMIN_HOST` is unset it defaults to `127.0.0.1` (as in the specification); the other five variables are required at startup, including `DATA_DIR` and `ENCRYPTION_KEY` (this change does not implement the store).
- `web/` is a minimal Vite + React + TypeScript shell so the admin process can serve the production build.
- Dependencies from "Stack" and "Repository build" in `mcp-gateway-spec.md` are declared: Express 5, `@modelcontextprotocol/sdk`, zod, Vitest, React, Vite. Radix is added only if the shell needs it.

## Non-goals

- The encrypted JSON store, writing through a temp file, and decrypt-error behavior (former `implementation.md` section 1.2).
- The `GET /health` response body (1.3).
- Limiting the MCP port to `/mcp` and `/health`, and refusing MCP on the admin port (1.4).
- The configurations API, MCP `tools/list` / `tools/call`, the Configurations and Connectors screens, the connector contract, proxy, and the call log.
- Dockerfile, compose, and a login in the admin UI.
- Directories `store/`, `configurations/`, `accounts/`, `connectors/`, and `mcp/` (tool routing) — later changes.

## Capabilities

### New Capabilities

- `process-startup`: parsing required environment variables, exiting with the missing variable's name and no values, two HTTP listeners (MCP and admin), `ADMIN_HOST` defaulting to `127.0.0.1`, and serving the admin build's static files.

### Modified Capabilities

- (none — `openspec/specs/` is empty)

## Impact

- Root `package.json` (workspaces, scripts) and new packages `server/` and `web/`.
- New runtime and dev dependencies (see design).
- Process entry point: `server/src/main.ts`; the only read of `process.env`.
- Vitest tests of environment and listener scenarios, with no external services.
