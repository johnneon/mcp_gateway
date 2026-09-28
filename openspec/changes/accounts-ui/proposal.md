# Proposal

Issue: #14

## Why

The accounts admin API and connector public descriptions exist, but the English admin UI still only lists connectors without account actions and has no way to grant accounts to configurations. Without that UI the operator cannot manage credentials or assign them before MCP tools use those accounts.

## What Changes

- Connectors screen loads connectors and accounts, groups accounts under each connector, and offers add, edit, check connection, disable, and delete per account. Rows show label, enabled, and non-secret values only; secret field keys are never rendered.
- One dialog form built from connector field descriptions (`text`, `secret`, `host`) plus a required account label that is not a connector field. Create uses `POST /api/accounts`; edit uses `PATCH` and omits blank secret keys so the store keeps them. After a successful create or edit, secret input state is cleared so the secret is absent from the document. Connection-check failures show the API error text, not a connector exception.
- Check connection on a saved account calls `POST /api/accounts/:id/check`. Disable is a checkbox that sends `PATCH { enabled }` only. Delete requires confirmation, then `DELETE`; the account disappears from configuration checkboxes after cascade.
- Configurations screen shows account checkboxes grouped by connector. Each toggle immediately `PUT`s the full `accountIds` list for that configuration. Disabled accounts are listed and may be assigned. Bearer token remains one-time in the create/rotate dialog only.
- Empty connector registry copy becomes exactly `No connectors yet.` The previous sentence that deferred accounts to a later change is removed. The rule that Connectors must not present account actions is replaced by this change's account-management requirements.
- Existing admin HTTP routes only; no new routes or response fields. Production connector registry stays empty; frontend tests use a fake `fetch` and a fixture secret that must be absent from the document after submit. No live provider.

## Non-goals

- Gmail connector, MCP tools, proxy connector kind, product login.
- New API fields or routes; redesign of accounts, configurations, or connectors APIs.
- Edits to `mcp-gateway-spec.md` or files under `openspec/specs/` during apply (delta only; sync at archive).

## Capabilities

### New Capabilities

- (none)

### Modified Capabilities

- `admin-configurations-ui`: Replace the Connectors empty-state copy and the "no account actions" rule with account management under each connector; add configuration account checkboxes grouped by connector that replace `accountIds` via the existing PUT route; keep one-time bearer reveal and English/no-login shell unchanged in intent.

## Impact

- `web/src/pages/ConnectorsPage/`, `web/src/pages/ConfigurationsPage/`, and new `web/src/features/accounts/` (api helpers, account form, list actions).
- Extend `web/src/features/configurations/api.ts` for `accountIds` on list items and `PUT /api/configurations/:id/accounts`.
- Extend `web/src/features/connectors/` usage so Connectors loads accounts alongside connectors.
- Existing Connectors RTL tests that assert "no account actions" and the long empty-state sentence are rewritten to match the new requirements in the same apply tasks.
- Server admin API, MCP port, encrypted store, and connector registry — no contract change in this change.
