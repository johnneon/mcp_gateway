# Proposal

Issue: #13

## Why

Configurations exist and connectors are typed in code, but the store and admin API still have no accounts. Without accounts that persist after a successful connection check and that configurations can reference, the operator cannot grant MCP clients a set of service credentials.

## What Changes

- **Document:** add `accounts: [{ id, connector, label, values, enabled }]`. Configurations gain `accountIds: string[]`. Existing configuration rows without `accountIds` read as `[]`.
- **BREAKING (delta):** replace the `configurations-api` requirement that forbids `accountIds` and that lists only `{ id, name, enabled }`. List, create, rotate, and enable/disable responses include `accountIds`. Plaintext bearer still appears only on create and rotate.
- Admin HTTP API for accounts: create, list (secrets omitted), patch, check connection, delete (removes the id from every configuration's `accountIds`).
- `PUT /api/configurations/:id/accounts` replaces the configuration's account set. Unknown or duplicate ids → 400, no write. Order of submitted ids is kept. Assigning a disabled account is allowed.
- Save (create, and patch that changes label or values) only after `checkConnection` succeeds on the merged values. Fixed English failure body `Connection check failed` (status 400); never forward connector exception text. Patch that changes only `enabled` does not call `checkConnection`.
- Host field values are hostname-only. Unknown keys in `values` → 400. Empty string on a secret field on patch means keep the stored value. Fixture secrets never appear in any response body, including errors.
- Production connector registry stays empty; tests inject a fake native connector. Unknown connector id → 400, no write.

## Non-goals

- Admin UI (issue #14, `accounts-ui`). Do not change the Connectors page or add account checkboxes. Do not modify `admin-configurations-ui` unless a configurations JSON shape change forces a delta; the extra `accountIds` field leaves the current UI working, so that UI spec stays unchanged.
- MCP tools, `tools/list`, `tools/call`.
- A Gmail connector or any product connector.
- A network client that enforces allowed destinations.
- Proxy kind and child processes.
- Browser e2e (this change does not change a screen).
- Edits to `mcp-gateway-spec.md` or `openspec/specs/` during propose/apply (sync at archive).

## Capabilities

### New Capabilities

- `accounts-api`: Accounts document shape; admin CRUD and connection-check routes; secret redaction in responses; delete cascading out of configuration `accountIds`; assignment of accounts to a configuration via PUT.

### Modified Capabilities

- `configurations-api`: Document and public responses include `accountIds`. Replace the requirement that forbids `accountIds` and that lists only `{ id, name, enabled }`. Create, rotate, and enable/disable responses include `accountIds`. Add `PUT /api/configurations/:id/accounts`.

## Impact

- New `server/` accounts service (no Express) on `EncryptedStore`, plus Express routes under `/api/accounts` and `PUT /api/configurations/:id/accounts`.
- Extend configurations service/document shape and public JSON to carry `accountIds` (default `[]` when absent).
- `createAdminApp` already accepts an injectable connector registry; accounts routes use that registry for field validation and `checkConnection`.
- Existing configurations HTTP tests that assert no `accountIds` must be updated to the new shape in the same apply tasks (product + tests for the modified scenarios).
- No `web/` changes. No product connector. No MCP changes.
