---
name: frontend
description: Builds the MCP Gateway admin UI with React, Vite, Radix UI primitives, and CSS modules, served by the same process as the server. Use when editing web/, admin screens, account forms, configuration screens, shared UI components, or styles.
---

# Frontend

The admin UI is React and Vite in `web/`, TypeScript in strict mode. The server process serves the production build on the admin port. There is no separate frontend service.

Screen behavior comes from the accepted change. This skill does not list connectors. Component tests follow `frontend-cover-tests` and are written in the same task as the component.

## Layout

```text
web/src/
  app/                   entry, layout, navigation, global styles and tokens
  pages/<Page>/          one smart component per screen
  features/<feature>/    smart containers, feature-only dumb components, api.ts
  shared/ui/<Name>/      generic dumb components, the only place that imports Radix
  shared/api/            fetch client and response types
  shared/lib/            pure helpers
  test/                  test setup and helpers
```

Create a folder only when a change needs it.

## Component folder

Each component lives in its own folder:

```text
AccountForm/
  AccountForm.tsx
  AccountForm.module.css
  AccountForm.test.tsx
  index.ts               re-export only
```

Import a component through its folder: `import { AccountForm } from '@/features/accounts/AccountForm'`. The `@` alias points to `web/src` in both `vite.config.ts` and `tsconfig.json`.

## Smart and dumb

- **Dumb** components get data and callbacks through props and render them. No fetch, no API imports, no global state, no routing. Local UI state (open, hover, input draft) is fine.
- **Smart** components load data, hold screen state, call the API, handle loading and error, and pass props down. They contain as little markup and styling as possible.
- Pages are smart. Everything in `shared/ui` is dumb.
- A feature component that grows both data logic and markup splits into `XContainer` (smart) and `X` (dumb).

## shared/ui

- Generic building blocks: `Button`, `Input`, `Field`, `Dialog`, `Table`, `Checkbox`, `Toast`, and so on.
- Built on Radix UI primitives (`@radix-ui/react-*`) for behavior and accessibility, styled with CSS modules. Features never import Radix directly.
- No domain knowledge: no "account", "connector", or "configuration" in `shared/ui`.
- Add a component here when a second feature needs it, or when it wraps a Radix primitive.

## Styles

- CSS modules only, next to the component: `Name.module.css`. No inline `style` except computed values. No CSS-in-JS, no Tailwind, no styled UI kit.
- Design tokens (colors, spacing, radius, font sizes) are CSS custom properties in `app/styles/tokens.css`. Modules use tokens, not raw values.
- Global CSS is only the reset and the tokens.
- Class names are camelCase: `styles.submitButton`.
- State styling uses Radix data attributes where they exist: `[data-state='open']`, `[data-disabled]`.

## Data and API

- All requests go through `shared/api`. It sends `Content-Type: application/json` on every mutation and turns non-2xx responses into typed errors.
- Each feature keeps its calls in `features/<feature>/api.ts`. Smart components call those functions; dumb components never do.
- Every async view has explicit loading, empty, and error states.

## Comments

Write a comment only where the logic is genuinely non-trivial or hard to see from the names and structure. The comment states the constraint or the reason, not a retelling of the next lines.

Leave ordinary code uncommented: no banners, no notes that repeat a function or variable name, no comments on straightforward control flow.

## Interface rules

- UI copy is English.
- There is no login screen. The operator's outer proxy protects the admin port.
- The account form is built from the connector's field description. Do not write a screen per connector.
- The raw bearer is shown once, on create and on rotate.
- An account secret never appears on screen: not after save, not in an error. An empty secret field on edit means "keep the current value".
- Every control has an accessible name: a visible label or `aria-label`.

## Check

1. `npm test -w web`, `npm run typecheck -w web`, `npm run build -w web` pass.
2. Exercise the changed screen in the browser: open, submit, empty state, error state.

Use the `e2e` skill only when the change is already with the validator. Do not act as the validator.
