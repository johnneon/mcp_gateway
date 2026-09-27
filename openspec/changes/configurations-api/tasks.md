# Tasks

## 1. Token module

- [x] 1.1 Add the token module (generate 32 random bytes as base64url without padding, SHA-256 hex of the exact token string, timing-safe compare of hashes). Unit tests: generated token round-trips through hash+compare; compare rejects a different string; hash equals Node `createHash('sha256')` of the token string. Check: the new token tests pass; `npm run typecheck -w server` exits 0.

## 2. Configurations service

- [x] 2.1 Implement the configurations service on `EncryptedStore` (no Express): empty `{}` → empty list; create / list / rotate / setEnabled / remove; document shape `{ configurations: [{ id, name, tokenHash, enabled }] }` with no `accountIds` and no plaintext token. Unit tests against an in-memory fake store cover empty-document list, create hash persistence, rotate replacing the hash, enable/disable, delete, and not-found errors. Check: the new service tests pass.

## 3. Admin /api wiring

- [x] 3.1 Add `/api` Content-Type middleware (non-GET under `/api` without media type `application/json` → 415, no state change; `application/json; charset=utf-8` accepted) and ensure no CORS headers are set. Mount configurations routes with zod validation: `POST /api/configurations`, `GET /api/configurations`, `POST .../rotate`, `PATCH .../:id`, `DELETE .../:id`. Change `createAdminApp` to require `store`; wire `main.ts` to keep the opened store and pass it in. Update existing admin factory call sites (mcp-port-routing tests) to pass a fake store without weakening their assertions. Check: `npm run typecheck -w server` exits 0; existing mcp-port-routing tests still pass.

## 4. HTTP scenario tests

- [x] 4.1 Supertest against `createAdminApp` with a fake store (and one real encrypted file for the disk canary): create 201 with token once; list without token/hash; rotate; patch enable/disable; delete 204; empty name → 400; unknown id → 404; form body and missing Content-Type → 415 with no state change; charset=utf-8 create succeeds; no CORS headers on success and on 415; create token absent from `state.bin` plaintext; `GET /mcp` on MCP still 501. Check: all new configurations-api HTTP tests pass; test names cover every delta scenario.

## 5. Full package check

- [ ] 5.1 From the root: `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build` exit 0. Check: every command exits 0.
