# Tasks

## 1. Connector contract and registry

- [x] 1.1 Add the native connector module types (id, name, kind `native | proxy`, account fields, allowed destinations as `{ host, port }` | `{ field, port }`, `checkConnection`) and `buildConnectorRegistry` that fails on bad/duplicate id, bad/duplicate field, bad allowed destination, and `kind: proxy`. Export a production empty registry. Unit tests with a fake native connector cover: successful build; `checkConnection` callable without live provider; valid fields; constant and field-backed destinations; field-backed destination naming a missing/non-host field fails; duplicate id fails; bad id fails; proxy kind fails without starting a child process; production export length 0. Check: those tests pass; `npm run typecheck -w server` exits 0.

## 2. Connectors admin API

- [x] 2.1 Wire an injectable connector registry into `createAdminApp` / `main.ts` (production empty). Add `GET /api/connectors` returning `{ id, name, kind, fields: [{ name, label, type, required }] }[]` without allowed destinations, connection-check, secrets, or account values. Tests: empty registry → 200 `[]`; fake registry → public description only (serialized body has no destination hosts/ports or secret values); GET without Content-Type → 200; no CORS headers on success. Check: connectors-api scenarios pass; existing configurations-api tests still pass; `npm run typecheck -w server` exits 0.

## 3. Connectors admin UI

- [x] 3.1 Update the Connectors page to fetch `GET /api/connectors`. Empty array keeps the exact empty-state copy. Non-empty list shows each connector `name` and each field's `label`, `type`, and `required`. No account action controls. English error on failed list without secrets. Replace RTL tests that asserted zero HTTP calls: cover empty list + copy, non-empty list without account actions/secrets, and list error. Check: Connectors tests pass; shell/nav tests still pass; `npm run typecheck -w web` exits 0.

## 4. Full package check

- [ ] 4.1 From the repository root: `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build` exit 0. Check: every command exits 0.
