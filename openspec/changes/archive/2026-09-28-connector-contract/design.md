# Design

## Context

See `proposal.md` — Why. The admin app today wires only configurations (`createAdminApp({ store })`) and serves a Connectors page that renders a static empty state with no HTTP calls (`admin-configurations-ui`). Vision contract: `mcp-gateway-spec.md` (Connector). This change introduces the native module contract, an empty production registry, `GET /api/connectors`, and a Connectors screen that lists the API response. Accepted approach overrides vision where they differ for this change: allowed destinations are host+port pairs; `proxy` is rejected at registry build; allowed destinations are omitted from the API; empty-state copy stays unchanged.

## Goals / Non-Goals

**Goals:**

- Typed native connector module + registry builder that fails on invalid descriptions and on `proxy`.
- Production registry export empty; tests inject a fake-native registry into `createAdminApp`.
- Admin `GET /api/connectors` public description only; Connectors UI lists it with the locked empty copy.

**Non-Goals:**

- Tools, accounts CRUD, connection-check UI or save path, network client, proxy runtime, Gmail connector.
- Edits to `mcp-gateway-spec.md` or `openspec/specs/` during apply.
- Browser/e2e in propose (later verify).

## Decisions

Accepted by the person before propose; they are not reopened here. No open questions remain for this change.

### 1. Connector module type (native only registrable)

- One TypeScript type (or equivalent) for a connector module: `id`, `name`, `kind: 'native' | 'proxy'`, `fields`, `allowedDestinations`, `checkConnection`.
- `checkConnection` lives on the module for later account save / UI check; this change does not call it from HTTP and does not save accounts.
- Host account fields document hostname-only values (no scheme, path, userinfo, or port in the value). Validating operator-entered host strings is deferred to accounts CRUD.

**Alternative (rejected):** separate public description type only, with no `checkConnection` on the module yet — rejected; the contract must include the check function now so later account work does not reshape the module.

### 2. Allowed destinations are host+port pairs

- Constant: `{ host: string, port: number }` declared in connector code.
- Operator host: `{ field: string, port: number }` where `field` names an account field of type `host` on the same connector; `port` stays in code.
- Motivating example for later Gmail (not in this change): `imap.gmail.com:993`, `smtp.gmail.com:465`.

**Alternative (rejected):** host-only allowlist without ports — rejected; Gmail needs distinct ports per host, and the person locked host+port pairs.

### 3. Registry is a code array; build validates; production is empty

- `buildConnectorRegistry(modules)` (name may vary) validates every module and returns an immutable registry used by the admin API.
- Failures: bad/duplicate `id`, bad/duplicate field names, bad field type, allowed destination that references a missing or non-`host` field, `kind: 'proxy'`.
- Production export: `buildConnectorRegistry([])` (or equivalent empty array).
- No runtime catalog, no POST to add connectors, no connectors config file.

**Alternative (rejected):** register proxy modules but no-op their child process — rejected; building the registry must reject `proxy` so no child process path exists in this change.

### 4. Inject registry into `createAdminApp`

- Extend `CreateAdminAppOptions` with a connector registry (required or defaulting to the production empty export).
- `main.ts` passes the production empty registry.
- Tests pass a registry built with a fake native connector when asserting list behavior.

**Alternative (rejected):** import the production registry singleton only — rejected; tests must not mutate a global and must not ship a fake connector in production.

### 5. Public API shape omits internals

- `GET /api/connectors` → `{ id, name, kind, fields: [{ name, label, type, required }] }[]`.
- Map from the registry; strip `allowedDestinations` and `checkConnection`.
- Same Express `/api` stack as configurations: JSON responses, short English errors, existing `requireJsonContentType` (GET exempt), no CORS headers.

**Alternative (rejected):** include allowed hosts in the admin API for operator transparency — rejected; the person locked omission of allowed destinations from the API.

### 6. Connectors screen lists API; empty copy unchanged

- On mount / when selected, fetch `GET /api/connectors`.
- Empty array → keep exact copy: `No connectors yet. Connector accounts will appear here in a later change.`
- Non-empty → show each `name` and each field's `label`, `type`, `required`.
- No account buttons. English errors on failed list, matching Configurations error style.
- Update RTL tests that currently assert zero HTTP calls when opening Connectors.

**Alternative (rejected):** change empty-state wording now that the API exists — rejected; copy stays locked.

### 7. Verification boundary for propose

- Automated tests use a fake connector only; no live provider.
- Screen change is in scope for later e2e/verify; this propose step writes artifacts only.

## Risks / Trade-offs

- [Existing Connectors RTL test expects no fetch] → Mitigation: replace that assertion in the same apply task that teaches the page to call `GET /api/connectors`; keep the empty-copy assertion.
- [Vision still describes proxy and host-only allowlists] → Mitigation: delta and design win until archive; do not edit `mcp-gateway-spec.md` or main specs during apply.
- [Host value validation deferred] → Mitigation: contract documents hostname-only meaning; accounts change enforces it on save.

## Migration Plan

- Ship empty production registry; existing operators see the same empty Connectors copy after the UI starts calling the API.
- No store document migration.
- Rollback: revert the change branch / PR; no encrypted-state reshape.

## Open Questions

None. The accepted decisions above close module shape, host+port destinations, proxy rejection at build, API omission of allowed destinations, empty production registry, injectable registry for tests, and empty-screen copy.
