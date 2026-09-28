# Proposal

Issue: #11

## Why

The configurations admin API exists, but the operator still has no English screen to list, create, rotate, enable or disable, or delete configurations, or to see a Connectors placeholder. Without that UI the bearer token cannot be shown once in the browser, and later account and connector screens have no shell to hang from.

## What Changes

- An English admin UI with no login: app shell, two nav items (Configurations and Connectors), screens switched in application state (no client router).
- Configurations screen against the existing admin API only: list, create with one-time bearer reveal, rotate with confirmation then one-time reveal, enable/disable, delete with confirmation. Mutations send `Content-Type: application/json`. The list never receives or renders a token; plaintext from create/rotate lives only in the open reveal dialog and is cleared when the dialog closes.
- Connectors screen: English empty state only; no accounts and no API calls.
- Shared dialog control wrapping Radix UI primitives, styled with CSS modules.
- React Testing Library component tests with a fake `fetch` covering empty list, create, token gone after dialog close, rotate, disable, delete, error, and the empty Connectors screen.

## Non-goals

- Account checkboxes on a configuration. The configurations API has no `accountIds`.
- Login, connectors (beyond the empty state), accounts, and any connector implementation.
- Changes to how the server serves static files.
- Browser/e2e checks in this propose step (they belong to later apply/verify).
- Edits to `mcp-gateway-spec.md` or files under `openspec/specs/` during propose or apply. Delta specs only under `openspec/changes/admin-configurations-ui/`; sync happens at archive.

## Capabilities

### New Capabilities

- `admin-configurations-ui`: English admin shell with Configurations and Connectors navigation; Configurations CRUD and one-time token reveal against the existing `/api/configurations` routes; Connectors empty state; token cleared from UI state when the reveal dialog closes.

### Modified Capabilities

- (none) — `configurations-api` HTTP contracts stay as they are; this change only consumes them from the web UI.

## Impact

- New and replaced modules under `web/src/` (app shell/nav, Configurations and Connectors pages/features, shared dialog UI, shared API client helpers).
- Add `@radix-ui/react-*` dependencies for dialog (and related primitives as needed) in the `web` workspace.
- Existing placeholder `App` shell and its tests are replaced to match the new screens.
- Server admin API, MCP port, encrypted store, and static-file serving — no contract change in this change.
