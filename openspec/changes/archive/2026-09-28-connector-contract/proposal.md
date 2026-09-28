# Proposal

Issue: #12

## Why

Accounts and MCP tools need a typed connector module before any provider ships. Today the product has no connector contract, no in-code registry, and no admin API for connector descriptions, so the Connectors screen cannot list what the process knows.

## What Changes

- A TypeScript connector module contract for **native** connectors only: `id` (`^[a-z0-9]+$`), display `name`, account fields (`name` same charset, unique within the connector; `label`; `type` `text` | `secret` | `host`; `required`), a connection-check function on the module (not exposed over HTTP), allowed destinations as host+port pairs (constant `{ host, port }` or operator field `{ field, port }` where `field` names a `host` account field), and `kind` typed as `native` | `proxy`.
- An in-code connector registry: a code array whose production export is empty. Building the registry rejects invalid descriptions (bad or duplicate id, bad field, bad allowed destination, `kind: proxy`). Tests inject their own registry (with a fake native connector) into the admin app factory. No runtime catalog, no API to add connectors, no connectors config file.
- `GET /api/connectors` on the admin port returns the public description of registered connectors: `{ id, name, kind, fields: [{ name, label, type, required }] }[]`. Same JSON and error style as configurations. Omits allowed destinations, the connection-check function, secrets, and account values. GET needs no JSON Content-Type. No CORS headers.
- The Connectors admin screen fetches that API. An empty array keeps the current empty-state copy. A non-empty list shows each connector name and its fields (label, type, required). No account buttons.

When the product vision and this accepted approach differ, this approach wins for the duration of the change (host+port pairs, proxy rejected at registry build, allowed destinations omitted from the API, empty-screen copy unchanged).

## Non-goals

- Tools, MCP `tools/list` population from connectors.
- Accounts CRUD, connection-check button in the UI, account save that invokes the check.
- A network client that enforces allowed destinations.
- Proxy child process or any registrable `proxy` connector.
- A Gmail connector (or any product connector); Gmail's later `imap.gmail.com:993` / `smtp.gmail.com:465` pairs only motivate the destination shape.
- Edits to `mcp-gateway-spec.md` or files under `openspec/specs/` during apply (sync at archive).
- Browser/e2e in this propose step (the screen change is in scope for later verify).

## Capabilities

### New Capabilities

- `connector-contract`: Native connector module shape, account fields, connection-check on the module, allowed destinations as host+port pairs, and an in-code registry that validates at build time and ships empty in production.
- `connectors-api`: Admin-port `GET /api/connectors` returning the public connector description array, without allowed destinations or connection-check, matching configurations JSON/error and CORS rules.

### Modified Capabilities

- `admin-configurations-ui`: Connectors screen loads `GET /api/connectors`; empty array keeps the existing empty-state copy; non-empty list shows connector name and fields; no account actions.

## Impact

- New modules under `server/` for the connector type, registry builder, production empty registry, and `GET /api/connectors` routed from `createAdminApp` with an injectable registry for tests.
- `createAdminApp` / `main.ts` wired to the production empty registry.
- Connectors page and its RTL tests under `web/` updated to fetch and render the API response.
- Existing Configurations UI and configurations API unchanged in contract.
