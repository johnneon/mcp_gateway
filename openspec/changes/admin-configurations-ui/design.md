# Design

## Context

See `proposal.md` — Why. The admin API for configurations is already shipped (`openspec/specs/configurations-api`). The `web` package today is a placeholder shell (`MCP Gateway` / `Admin shell`) with Vitest and React Testing Library, but without Radix, navigation, or API calls. Vision screens: `mcp-gateway-spec.md` (Interface — Configurations and Connectors). This change implements Configurations management and a Connectors empty state only; account checkboxes are out because the API has no `accountIds`.

## Goals / Non-Goals

**Goals:**

- English admin shell: Configurations and Connectors, switched in React state, no client router, no login.
- Configurations UI against existing `/api/configurations` only; one-time token reveal; confirm before rotate and delete.
- Connectors English empty state with no API traffic.
- Shared dialog wrapping Radix, styled with CSS modules; RTL tests with fake `fetch`.

**Non-Goals:**

- Account checkboxes, accounts API, connector catalog or implementation.
- Changing static-file serving on the admin port.
- Browser/e2e automation in the propose step (apply/verify later).
- Editing `mcp-gateway-spec.md` or `openspec/specs/` until archive.

## Decisions

Accepted by the person before propose; they are not reopened here. No open questions remain for this change.

### 1. App shell and navigation without a client router

- Two nav items: Configurations and Connectors.
- Active screen is React application state (for example a `screen` enum or equivalent). Selecting a nav item updates that state and renders the matching page component.
- Do not add `react-router` or another client router.
- Do not change how the server serves static files (`createAdminApp` static middleware stays as it is).

**Alternative (rejected):** client-side routes such as `/configurations` and `/connectors` — rejected; accepted approach is in-app state only, and the server already serves the SPA for non-API paths without route-specific HTML.

### 2. Configurations uses the existing admin API only

| Action | Method and path | Request | Success use of response |
| --- | --- | --- | --- |
| List | `GET /api/configurations` | — | `{ id, name, enabled }[]` into list state |
| Create | `POST /api/configurations` | `{ name }` | show `token` in reveal dialog; refresh list |
| Enable/disable | `PATCH /api/configurations/:id` | `{ enabled }` | update list row |
| Delete | `DELETE /api/configurations/:id` | empty JSON Content-Type | remove row |
| Rotate | `POST /api/configurations/:id/rotate` | empty JSON Content-Type | show new `token` in reveal dialog |

- Every mutation sets `Content-Type: application/json` (including rotate and delete with an empty body), matching `configurations-api`.
- Feature API helpers live under `web/src/features/configurations/`; shared fetch helper under `web/src/shared/api/`.
- No new server routes and no changes to response shapes.

**Alternative (rejected):** embed tokens in list state for convenience — rejected; list must never hold plaintext tokens.

### 3. One-time token reveal dialog

- Create and rotate success paths open a reveal dialog that displays the plaintext `token` from that response only.
- The plaintext token lives only in the state that feeds the open dialog. Closing the dialog clears that state so the string is gone from the document.
- The configurations list state and list rendering never store or show `token` or `tokenHash`.

**Alternative (rejected):** keep the last token in component state after close for "show again" — rejected; product rule is once only in the UI as well as in the API.

### 4. Confirmation before delete and rotate

- Delete is irreversible; rotate replaces `tokenHash` immediately on the server. Both require a confirmation dialog (or equivalent confirm step) before the mutation `fetch` runs.
- After a confirmed rotate succeeds, the new token is shown in the one-time reveal dialog (decision 3).
- Dismissing confirmation without confirming sends no mutation request.

**Alternative (rejected):** rotate without confirm because the new token appears in a dialog — rejected; the hash is already replaced on success, so accidental rotate would invalidate clients immediately.

### 5. Connectors empty state

- Connectors screen is English empty-state copy only.
- No accounts UI and no HTTP calls when that screen mounts or is selected.

**Alternative (rejected):** call a future connectors API with an empty response — rejected; no such API in this change; keep the screen offline.

### 6. Shared UI: Radix dialog, CSS modules, English copy

- Follow the frontend skill layout: `app/` shell and nav, `pages/` or feature containers for screens, `shared/ui` for the dialog (and other controls that wrap Radix behavior), CSS modules next to components, tokens in `app/styles` as needed.
- Only `shared/ui` imports `@radix-ui/react-*`. Features and pages do not import Radix directly.
- Add the needed `@radix-ui/react-dialog` (and any small companion primitives required by the shared controls) to the `web` workspace.
- UI copy is English. No login screen.

**Alternative (rejected):** hand-rolled modal without Radix — rejected; project stack calls for Radix primitives for behavior and accessibility.

### 7. Tests (apply phase)

- React Testing Library + Vitest with a fake `fetch` (`mockFetch` / equivalent in `web/src/test/`).
- Cover: empty list; create with token in dialog; token absent after dialog closes; rotate (confirm → request → reveal → clear); disable; delete; API error; Connectors empty state with no requests.
- Assert request method, path, JSON body, and `Content-Type: application/json` on mutations.
- Do not weaken existing assertions; replace the obsolete "no Configurations or Connectors" placeholder test to match the new shell.
- Browser walkthrough is for later apply/verify, not this propose step.

## Risks / Trade-offs

- [Operator closes the reveal dialog before copying the token] → Mitigation: dialog copy makes clear the token is shown once; rotate remains available after confirm.
- [Fake fetch tests miss portal focus quirks] → Mitigation: query via `screen` for Radix portals; full browser check deferred to verify/e2e.
- [Placeholder App test expects no Configurations/Connectors text] → Mitigation: update that test in the same apply task that introduces the shell; do not delete coverage of the shell heading.

## Migration Plan

- No data migration. Deploy is a normal web build served by the existing admin static middleware.
- Rollback: revert the change branch / deploy previous web build; API remains compatible.

## Open Questions

None. The accepted decisions above close navigation, API usage, token lifetime in the UI, confirmations, Connectors scope, Radix/dialog styling, and the test boundary for this propose step.
