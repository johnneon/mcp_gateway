# Design

## Context

See `proposal.md` — Why. The accounts admin API (`openspec/specs/accounts-api`), connectors list API (`openspec/specs/connectors-api`), and configurations list with `accountIds` (`openspec/specs/configurations-api`) are already shipped. The English admin shell, Configurations CRUD with one-time bearer reveal, and Connectors list without account actions live under `web/` per `admin-configurations-ui`. Vision screens: `mcp-gateway-spec.md` (Interface — Connectors with accounts; Configurations with account checkboxes). This change is UI-only against those existing routes.

## Goals / Non-Goals

**Goals:**

- Operator manages accounts under each connector and grants them to configurations in the existing English admin UI.
- One account form from connector field descriptions; no per-connector screen.
- Secrets never appear on screen or in API responses the UI displays; blank secret on edit omits the key.
- Use only existing HTTP routes; production registry stays empty; tests use fake `fetch`.

**Non-Goals:**

- Gmail connector, MCP tools, proxy connector kind, product login.
- New API fields or routes; server contract changes.
- Edits to `mcp-gateway-spec.md` or main `openspec/specs/` during apply.
- Live Gmail or other provider in tests.

## Decisions

Accepted by the person before propose; they are not reopened here. No open questions remain for this change.

### 1. UI-only; reuse existing admin API

| Action | Method and path | Request notes |
| --- | --- | --- |
| List accounts | `GET /api/accounts` | Public objects; secret keys absent from `values` |
| Create account | `POST /api/accounts` | `{ connector, label, values }` full values |
| Edit account | `PATCH /api/accounts/:id` | Omit blank secret keys; enabled-only patch is `{ enabled }` only |
| Check connection | `POST /api/accounts/:id/check` | No store write |
| Delete account | `DELETE /api/accounts/:id` | Cascades out of configuration `accountIds` on the server |
| Assign accounts | `PUT /api/configurations/:id/accounts` | Full `accountIds` replacement |
| List connectors / configurations | `GET /api/connectors`, `GET /api/configurations` | Configurations include `accountIds`; no token |

- No new HTTP routes and no redesign of request or response shapes.
- Feature helpers: `web/src/features/accounts/api.ts`; extend `features/configurations/api.ts` with `accountIds` and `setConfigurationAccounts`.
- Shared `apiRequest` continues to set `Content-Type: application/json` on mutations.

**Alternative (rejected):** add UI-specific aggregate endpoints — rejected; person locked existing routes only.

### 2. Connectors screen: group accounts under connectors

- On mount / select: load connectors and accounts in parallel.
- Render each connector by `name`; under it, accounts where `account.connector === connector.id`.
- Per account row: `label`, `enabled`, non-secret `values` only. Do not render keys for fields of type `secret` (API already omits them; UI must not invent empty secret placeholders as labeled secret keys).
- Per connector: add account. Per account: edit, check connection, disable, delete.
- Empty connectors array: exact copy `No connectors yet.` (replaces the deferred-accounts sentence).

**Alternative (rejected):** a separate Accounts nav item — rejected; vision places accounts under Connectors.

### 3. One dialog form from field descriptions

- Form fields: required `label` (not a connector field) plus one control per connector field (`text`, `secret`, `host`).
- Create: POST with full `values` including secrets.
- Edit: prefill non-secret values and label; secret inputs start empty; on submit, omit any secret key whose input is blank (keep stored value).
- After successful create or edit: clear secret input state (and close the dialog) so the secret string is not in the document.
- Connection-check failure (create/edit/check): show `ApiError` / response body text (e.g. `Connection check failed`); never surface a connector exception object or stack.

**Alternative (rejected):** one custom screen per connector id — rejected; form is driven by `fields` only.

### 4. Disable, check, delete

- Disable: checkbox → `PATCH { enabled }` only (no `label`/`values`); server skips `checkConnection`.
- Check connection: `POST .../check` for a saved account id.
- Delete: confirmation dialog (same pattern as configuration delete), then `DELETE`. After success, refresh accounts (and configurations when on that screen / when returning) so checkboxes lose the deleted id via server cascade reflected in `GET`.

**Alternative (rejected):** disable via the full edit form — rejected; enabled-only patch is the accepted API contract.

### 5. Configurations: account checkboxes and immediate PUT

- Under each configuration, group checkboxes by connector name; each checkbox is one account (`label`, show disabled state).
- Checked set = that configuration's `accountIds`.
- Every toggle builds the full next `accountIds` array and immediately `PUT`s it.
- Disabled accounts remain listed and may be checked.
- Bearer token stays only in the existing create/rotate reveal dialog; list never holds plaintext token.

**Alternative (rejected):** a Save button for account grants — rejected; person locked immediate PUT per toggle.

### 6. Tests (apply phase)

- React Testing Library + Vitest with existing `mockFetch` in `web/src/test/`.
- Cover every new and modified delta scenario; assert fixture secret absent from `document` after successful create/edit submit.
- Rewrite Connectors tests that currently assert "no account actions" and the long empty-state sentence.
- Extend Configurations tests for checkbox PUT and disabled-account assign; keep token reveal scenarios.
- Production registry empty; no live provider; no Playwright in propose (verify/e2e later).

**Alternative (rejected):** hit a live Gmail mailbox in CI — rejected.

### 7. Frontend layout

Follow the frontend skill:

```text
web/src/features/accounts/     api.ts, AccountForm/, account list helpers as needed
web/src/pages/ConnectorsPage/  smart page: load, group, wire actions
web/src/pages/ConfigurationsPage/  add checkbox groups; keep token reveal
```

- Reuse shadcn `Dialog`, `Input`, `Label`, `Checkbox`, `Button`. Add further shadcn primitives only via CLI if a task needs them.
- English copy; no login.

## Risks / Trade-offs

- [Existing Connectors tests assert no account actions and old empty copy] → Mitigation: rewrite those tests in the same apply task that changes the page; do not weaken unrelated shell or configurations assertions.
- [Operator pastes a secret then leaves the dialog open] → Mitigation: clear secret inputs on successful submit and on dialog close after success; edit still never reloads secrets from the API.
- [Immediate PUT on every checkbox can race] → Mitigation: disable the checkbox group for that configuration while a PUT is in flight; refresh from the PUT response or reload list on error.
- [Configuration list type currently omits `accountIds`] → Mitigation: extend the TypeScript type and list mapping in the same task that adds checkboxes; server already returns the field.

## Migration Plan

- No data migration. Deploy is a normal web build served by existing admin static middleware.
- Rollback: revert the change branch / previous web build; API remains compatible.

## Open Questions

None. The accepted plan locks UI-only scope, existing routes, Connectors grouping and empty copy, form/secret-omit/clear behavior, disable/check/delete, immediate configuration PUT with disabled accounts assignable, and fake-fetch tests without a live provider.
