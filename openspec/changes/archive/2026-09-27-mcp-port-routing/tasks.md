# Tasks

## 1. MCP app: health, stub /mcp, 404

- [x] 1.1 Add `supertest` (and types if needed) to the `server` package devDependencies. In `createMcpApp`: `GET /health` → 200, `Content-Type: application/json`, body exactly `{ "status": "ok" }`; `app.all('/mcp')` → 501, `text/plain; charset=utf-8`, body `Not Implemented`; a final handler → 404, body `Not Found`. Automated tests through `supertest` without `listen`: scenarios GET /health without and with Authorization, and with a query string; GET/POST /mcp → 501; GET /unknown, POST/PUT/DELETE /health, GET /health/ → 404; bodies without secrets/canaries. Check: the new tests pass; `npm run typecheck -w server` exits 0.

## 2. Admin: /mcp before static files

- [x] 2.1 In `createAdminApp`, before `express.static`, register `app.all('/mcp')` → 404, `text/plain; charset=utf-8`, body `Not Found`. Automated tests: GET and POST `/mcp` → 404 even when a colliding file is in the test `webRoot`; GET `/` still returns the shell HTML. Check: the admin routing tests pass.

## 3. Full package check

- [x] 3.1 From the root: `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build` exit 0. Test names cover every scenario of the `mcp-port-routing` delta. Check: every command exits 0.
