---
name: frontend-cover-tests
description: Covers MCP Gateway admin UI code with unit tests and React Testing Library component tests on Vitest. Use when writing or changing a component, hook, or helper in web/, or when adding tests or test setup for the frontend.
---

# Frontend tests

Every component, hook, and helper in `web/` gets tests in the same task that creates or changes it. Scenario coverage rules are in the `tests` skill; this skill says how to write frontend tests.

## Tools

- Vitest with the `jsdom` environment.
- `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`.
- Setup in `web/src/test/setup.ts`: jest-dom matchers, `cleanup` after each test, and the jsdom gaps Radix needs (`ResizeObserver`, `Element.prototype.hasPointerCapture`, `Element.prototype.scrollIntoView`).
- Helpers in `web/src/test/`: `renderWithProviders` if the app gains providers, and `mockFetch` for API responses.

The test file sits next to the code: `AccountForm.test.tsx`, `format.test.ts`.

## What to test

| Code | Test | Focus |
| --- | --- | --- |
| `shared/lib` helper | unit | inputs and outputs, edge cases |
| `shared/api` client | unit with `mockFetch` | JSON header on mutations, error mapping |
| `shared/ui` component | RTL | render by props, keyboard and mouse interaction, disabled and error states, accessible name |
| feature dumb component | RTL | every prop branch, callbacks called with the right arguments |
| smart component or page | RTL with `mockFetch` | loading, empty, error, success; the request that was sent |

## How to write

- Query like a user: `getByRole` first, then `getByLabelText`, then `getByText`. `getByTestId` only when nothing else identifies the element.
- Interact through `userEvent.setup()`, not `fireEvent`.
- Wait with `findBy*` or `waitFor`, never with timers.
- Assert what the user sees or what leaves the component: text, roles, states, callback calls, requests. Do not assert internal state, hook calls, or class names.
- Radix dialogs and menus render in a portal. Query through `screen`, not the render container.
- Smart components are tested against `mockFetch` at the network boundary, not by mocking their own `api.ts`. Check the method, the path, the JSON body, and `Content-Type: application/json`.
- No snapshot tests of whole trees.
- One behavior per test. The name says the behavior: `shows the token once after create`.
- Every test builds its own data. No shared mutable fixtures between tests.

## Secrets

When a component handles an account secret or a bearer:

- after save, the secret value is absent from the document (`queryByText(secret)` is `null`) and the secret input is empty;
- an error response that contains the secret does not put it on screen;
- the bearer is visible after create or rotate and gone once the dialog closes.

## Commands

`npm test -w web`. Run a single file with `npm test -w web -- AccountForm`.

Do not delete or weaken an assertion to make a test pass. Fix the code, or stop and report a wrong scenario.
