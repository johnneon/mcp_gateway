# Tasks

## 1. Shared foundations

- [ ] 1.1 Add `@radix-ui/react-dialog` (and any companion Radix packages required by the shared dialog) to the `web` workspace; extend `web/src/test/setup.ts` with jsdom gaps Radix needs if not already present (`ResizeObserver`, pointer capture, `scrollIntoView`). Add `web/src/shared/api` fetch helper that sets `Content-Type: application/json` on every mutation and maps non-2xx to typed English errors. Unit-test the helper with fake `fetch`: JSON header on POST/PATCH/DELETE, error mapping. Check: new shared API tests pass; `npm run typecheck -w web` exits 0.

- [ ] 1.2 Add shared Dialog under `web/src/shared/ui` wrapping Radix Dialog, styled with a CSS module; features must not import Radix. Component test: open/close by accessible name, content visible while open and gone after close. Check: Dialog tests pass.

## 2. App shell and Connectors

- [ ] 2.1 Replace the placeholder App with an English shell: nav items Configurations and Connectors, active screen in React state (no client router), no login. Default screen Configurations. Update `App.test.tsx` so it asserts the shell and nav instead of the old "no Configurations/Connectors" placeholder. Check: shell tests pass; selecting Connectors does not change `window.location.pathname`.

- [ ] 2.2 Add the Connectors page as an English empty state with no HTTP calls on mount or when selected. RTL test: empty-state copy visible; fake `fetch` receives zero calls when opening Connectors. Check: Connectors tests pass.

## 3. Configurations feature

- [ ] 3.1 Add `features/configurations/api.ts` and the Configurations screen: list via `GET /api/configurations` (empty state, name + enabled, never render token/hash); create via `POST` with `{ name }` then one-time reveal dialog; clear token from state when the dialog closes; confirm then `POST .../rotate` and reveal; confirm then `DELETE`; `PATCH` enable/disable; English error on failed list/mutation. RTL tests with fake `fetch` cover: empty list; create shows token then token gone after dialog close; rotate confirm → request → reveal → clear; rotate dismiss sends no request; disable sends PATCH with JSON Content-Type; delete confirm removes row; delete dismiss sends no request; list error shows English message without a token. Check: Configurations tests pass; every delta scenario for Configurations is named in a test.

## 4. Full package check

- [ ] 4.1 From the repository root: `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build` exit 0. Check: every command exits 0.
