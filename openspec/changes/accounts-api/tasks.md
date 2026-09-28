# Tasks

## 1. Configurations accountIds

- [x] 1.1 Extend the configurations document and service so each configuration has `accountIds: string[]` (missing on read → `[]`; new creates write `[]`). Public create, list, rotate, and patch responses include `accountIds`. Add `setAccountIds` and a helper that removes one account id from every configuration. Update existing configurations unit and HTTP tests that asserted no `accountIds` so they match the delta. Check: configurations service and HTTP tests for the modified scenarios pass; `npm run typecheck -w server` exits 0.

## 2. Accounts service

- [x] 2.1 Implement the accounts service on `EncryptedStore` plus `ConnectorRegistry` (no Express): empty `{}` → empty list; create / list (public view with secret keys absent) / patch (secret keep, enabled-only skips check) / checkConnection / remove with cascade via configurations helper. Validate required fields, unknown keys, hostname-only host values, label trim, UUID ids, `enabled: true` on create. Connection-check failure maps to a domain error with fixed message `Connection check failed` (no connector exception text). Unit tests with a fake connector cover create-after-check, check failure without write, secret keep on patch, enabled-only skip, host/unknown-key rejection, delete cascade. Check: new accounts service tests pass; fixture secret never appears in public view objects.

## 3. Admin HTTP routes

- [ ] 3.1 Mount `GET|POST /api/accounts`, `PATCH|DELETE /api/accounts/:id`, `POST /api/accounts/:id/check`, and `PUT /api/configurations/:id/accounts` on `createAdminApp` using the injectable registry. Reuse existing JSON Content-Type middleware and short English 404 plain text. Map connection-check failure to status 400 with body exactly `Connection check failed`. Check: `npm run typecheck -w server` exits 0.

## 4. HTTP scenario tests

- [ ] 4.1 Supertest against `createAdminApp` with a memory store and injected fake native connector (controllable `checkConnection`): list empty; create 201 with secrets omitted; unknown connector 400; check failure 400 fixed body and no save; host with scheme 400; unknown values key 400; patch empty secret keeps and rechecks; enabled-only patch skips check; empty required non-secret 400; check endpoint no write; delete 204 cascades from configurations; PUT accountIds order preserved; unknown/duplicate account ids 400 no write; disabled account assignable; form Content-Type 415; no CORS headers; fixture secret absent from every serialized response including errors; configurations list/create/rotate/patch include `accountIds`. Check: all new accounts-api HTTP tests pass; test names cover every delta scenario in `accounts-api` and the modified `configurations-api` scenarios.

## 5. Full package check

- [ ] 5.1 From the root: `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build` exit 0. Check: every command exits 0.
