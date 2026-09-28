# Tasks

## 1. Accounts API client and form

- [x] 1.1 Add `web/src/features/accounts/api.ts` with typed helpers for `GET/POST /api/accounts`, `PATCH /api/accounts/:id`, `POST /api/accounts/:id/check`, and `DELETE /api/accounts/:id`. Extend `web/src/features/configurations/api.ts` so list/create/rotate/patch types include `accountIds` and add `setConfigurationAccounts(id, accountIds)` calling `PUT /api/configurations/:id/accounts`. Unit-test the new helpers with fake `fetch` (method, path, JSON body, Content-Type). Check: accounts and configurations api tests pass; `npm run typecheck -w web` exits 0.

- [x] 1.2 Add `AccountForm` (dumb) under `features/accounts/AccountForm/`: required label plus controls from connector `fields` (`text`, `secret`, `host`). Create mode submits full values; edit mode starts secrets empty and omits blank secret keys from `values`. Clear secret input state after successful submit (and when the dialog closes after success). Component tests with fake callbacks cover create payload, edit omit-blank-secret, and secret absent from the document after success. Check: AccountForm tests pass.

## 2. Connectors screen with accounts

- [ ] 2.1 Rework `ConnectorsPage` to load connectors and accounts, show empty copy exactly `No connectors yet.`, group accounts under each connector (label, enabled, non-secret values only; no secret field keys), and wire add/edit via `AccountForm` dialog to POST/PATCH. On create/edit failure show API error text (e.g. `Connection check failed`). Rewrite obsolete Connectors tests that asserted no account actions and the old empty-state sentence. RTL scenarios: empty list copy; group accounts; create clears fixture secret; edit omits blank secret; create check-failure shows API text. Check: Connectors tests pass; every ADDED/MODIFIED Connectors-related delta scenario is named in a test.

- [ ] 2.2 Add check connection (`POST .../check`), enabled checkbox (`PATCH { enabled }` only), and delete with confirmation then `DELETE`. RTL scenarios: check calls check route only; disable sends enabled-only PATCH; delete confirm removes row; delete dismiss sends no DELETE. Check: Connectors action tests pass.

## 3. Configuration account checkboxes

- [ ] 3.1 On `ConfigurationsPage`, load accounts and connectors as needed; under each configuration render account checkboxes grouped by connector; include disabled accounts; each toggle immediately PUTs the full `accountIds` list; keep bearer only in create/rotate reveal. RTL scenarios: check sends full list; disabled account assignable; uncheck sends list without that id; no token shown from toggle. Check: Configurations checkbox tests pass; token reveal tests still pass.

## 4. Full package check

- [ ] 4.1 From the repository root: `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build` exit 0. Check: every command exits 0.
