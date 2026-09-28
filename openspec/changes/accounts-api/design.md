# Design

## Context

See `proposal.md` — Why. The encrypted store, configurations admin API, connector contract, and empty production registry already exist. `createAdminApp({ store, connectorRegistry? })` mounts configurations and connectors routes. Configurations today forbid `accountIds` in the main `configurations-api` spec; this change's delta replaces that. Domain model confirmed by the person: a connector is a code module (not a state row, not owned by a configuration); an account is a stored instance of a connector (many accounts per connector id); a configuration is a separate MCP access grant with `accountIds` pointing at accounts.

## Goals / Non-Goals

**Goals:**

- Persist accounts in the encrypted document; assign them to configurations over the admin HTTP API.
- Save only after `checkConnection` succeeds (except enabled-only patch).
- Never return secret field values in API responses; never forward connector exception text on check failure.
- Cascade account delete out of every configuration's `accountIds`.

**Non-Goals:**

- Admin UI, MCP tools, product connectors, network client, proxy runtime, browser e2e.
- Edits to `mcp-gateway-spec.md` or main `openspec/specs/` during apply.
- Changing `admin-configurations-ui` (extra `accountIds` on configuration JSON is additive; the current UI ignores unknown fields).

## Decisions

Accepted by the person before propose; they are not reopened here. No open questions remain for this change.

### 1. Domain model

- **Connector:** module in code; registry only; never a row in the state file; not owned by a configuration.
- **Account:** stored instance of a connector: `{ id, connector, label, values, enabled }`. One connector id may have many accounts.
- **Configuration:** `{ id, name, tokenHash, enabled, accountIds }` — MCP access grant. Does not embed connectors.

**Alternative (rejected):** nest connectors under configurations — rejected; the person locked the three-layer model above.

### 2. Document shape and migration read

```text
{
  configurations: [{ id, name, tokenHash, enabled, accountIds }],
  accounts: [{ id, connector, label, values, enabled }]
}
```

- Missing `accounts` or document `{}` → empty accounts list.
- Configuration rows without `accountIds` → read as `[]`. New creates write `accountIds: []`.
- After successful account or configuration mutations that touch those collections, persist the corresponding arrays.

**Alternative (rejected):** require a one-shot rewrite of all configuration rows on startup — rejected; lazy default on read is enough.

### 3. Layering

```text
server/src/
  accounts/           service: list/create/patch/check/remove; validate values; redact secrets for public views
  configurations/     extend for accountIds; setAccountIds; removeAccountIdFromAll on account delete
  http/api/           accountsRoutes; PUT on configurations for account assignment
  connectors/         existing registry + checkConnection (unchanged contract)
```

- Accounts service takes `EncryptedStore` and a `ConnectorRegistry`. No Express imports.
- HTTP maps domain errors to 400 / 404 / 415 / 201 / 200 / 204.
- `createAdminApp` mounts `/api/accounts` and `PUT /api/configurations/:id/accounts` using the same injectable registry as connectors.

**Alternative (rejected):** call `checkConnection` only from route handlers — rejected; keep validation and check in the service so unit tests cover merge/keep semantics without Express.

### 4. Connection check rules

- Create: validate, then `checkConnection(full values)`, then save with `enabled: true`.
- Patch that changes `label` or effective `values` (after empty-secret keep): `checkConnection(merged values including kept secrets)`, then save.
- Patch that changes only `enabled`: no `checkConnection`.
- `POST .../check`: `checkConnection(stored values)`, no write.
- Failure: HTTP 400, body exactly `Connection check failed` (plain text). Never forward connector exception text. Do not save.

**Alternative (rejected):** return connector error messages to the operator — rejected; secrets may appear in exception text.

### 5. Values validation and secret keep

- Ids: `crypto.randomUUID()` (same style as configurations). Label: non-empty after trim. New accounts: `enabled: true`.
- Unknown keys in `values` → 400.
- Host fields: hostname only — no scheme, path, userinfo, or port.
- Create: required fields present and non-empty.
- Patch: missing `values` key → keep stored; empty string on secret → keep; empty string on required non-secret → 400; empty string on optional non-secret → store `""`.
- Public JSON: omit keys of type `secret` from `values` (absent, not `""`).

**Alternative (rejected):** send empty strings for redacted secrets — rejected; the person locked key absence.

### 6. Configuration account assignment

- `PUT /api/configurations/:id/accounts` with `{ accountIds }`.
- Reject duplicates and unknown account ids with 400 and no write.
- Preserve submitted order.
- Disabled accounts may remain in / be assigned to `accountIds`. Only account delete removes an id from those lists.

**Alternative (rejected):** strip disabled accounts from `accountIds` on assign — rejected; disabled may remain until delete.

### 7. Admin HTTP surface

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/api/accounts` | Public accounts; secret keys absent |
| POST | `/api/accounts` | Create after check; 201; enabled true |
| PATCH | `/api/accounts/:id` | Edit label / values / enabled |
| POST | `/api/accounts/:id/check` | checkConnection; no write |
| DELETE | `/api/accounts/:id` | 204; cascade out of all `accountIds` |
| PUT | `/api/configurations/:id/accounts` | Replace set |
| GET | `/api/configurations` | Include `accountIds` |

- Same Content-Type and no-CORS rules as configurations.
- 404: short English plain text.
- Production registry empty; tests inject fake native connector.
- Fixture secret must not appear in any response body, including errors.

### 8. Tests (apply phase)

- Fake native connector with text, secret, and host fields; controllable `checkConnection`.
- Supertest against `createAdminApp` with memory store + injected registry.
- Cover every delta scenario; assert fixture secret absent from serialized bodies.
- Update existing configurations tests that asserted no `accountIds`.
- No Playwright; no live provider.

## Risks / Trade-offs

- [Existing configurations tests assert no `accountIds`] → Mitigation: update those assertions in the same apply task that changes the document shape; do not weaken unrelated assertions.
- [Admin UI may ignore `accountIds` until issue #14] → Mitigation: leave `admin-configurations-ui` unchanged; additive JSON field.
- [Connector exception text may contain secrets] → Mitigation: fixed failure body only; never stringify the error into the HTTP response.

## Migration Plan

- Old configuration rows without `accountIds` read as `[]`; next successful mutation may persist the field.
- New `accounts` key appears on first account write.
- Rollback: revert the change branch / PR; operators with accounts already saved would lose the accounts API (document may still contain `accounts` / `accountIds` keys, which older code ignored or forbade — accept on rollback of an unreleased change).

## Open Questions

None. The accepted plan locks domain model, document shape, HTTP routes, connection-check failure text, secret keep/redaction, host validation, enabled-only patch skipping the check, PUT duplicate/unknown rejection, disabled-account assignment, and UI non-goals.
