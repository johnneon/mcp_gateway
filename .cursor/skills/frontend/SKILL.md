---
name: frontend
description: Builds the MCP Gateway admin UI with React, Vite, shadcn/ui, and Tailwind, served by the same process as the server. Use when editing web/, admin screens, account forms, configuration screens, shared UI components, or styles.
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
  components/ui/         shadcn/ui primitives added by the CLI
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
  AccountForm.test.tsx
  index.ts               re-export only
```

Tailwind classes live on the elements. Import a component through its folder: `import { AccountForm } from '@/features/accounts/AccountForm'`. The `@` alias points to `web/src` in both `vite.config.ts` and `tsconfig.json`.

## Smart and dumb

- **Dumb** components get data and callbacks through props and render them. No fetch, no API imports, no global state, no routing. Local UI state (open, hover, input draft) is fine.
- **Smart** components load data, hold screen state, call the API, handle loading and error, and pass props down. They contain as little markup and styling as possible.
- Pages are smart. Everything in `components/ui` is dumb.
- A feature component that grows both data logic and markup splits into `XContainer` (smart) and `X` (dumb).

## components/ui

- Generic building blocks from shadcn/ui: `Button`, `Input`, `Field`, `Dialog`, `Table`, `Checkbox`, `Toast`, and so on.
- Add a primitive with `npx shadcn@latest add <component>` from the `web` workspace. Do not hand-write a wrapper and do not add `@radix-ui/react-*` yourself.
- Features and pages import `@/components/ui/...` only. They do not import `@radix-ui/*`.
- No domain knowledge: no "account", "connector", or "configuration" in `components/ui`.
- A generated file under `components/ui` may import whatever package the CLI writes.

## Styles

- Tailwind utility classes for new screens, features, and shadcn components. Do not add a CSS module for a shadcn component. Do not introduce a second styling system.
- No inline `style` except computed values. No CSS-in-JS.
- Theme tokens are the CSS variables the shadcn init writes.
- Global CSS is only the reset and the theme variables from the shadcn setup.

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
2. From the repo root, `npm run lint` and `npm run format:check` pass. Do not use explicit `any`; `@typescript-eslint/no-explicit-any` is an error for `web/` sources and tests.
3. Exercise the changed screen in the browser: open, submit, empty state, error state.

Use the `e2e` skill only when the change is already with the validator. Do not act as the validator.
