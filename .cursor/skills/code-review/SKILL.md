---
name: code-review
description: Reviews an MCP Gateway change diff against its OpenSpec delta, the project laws, and the backend and frontend skills, and looks for secret leaks. Use when reviewing a change, a pull request, or a diff before archive. Reports blockers and does not edit the product.
---

# Code review

Review `git diff origin/main...HEAD` on `change/<name>` against the accepted artifacts, `AGENTS.md`, and the `backend`, `frontend`, and `frontend-cover-tests` skills. A style note is not a blocker.

## Blocker

- A secret, raw bearer, or encryption key appears in an MCP response, an error, the admin API, a log line, the screen, or a test snapshot that is returned to the client.
- A tool argument carries a URL, a host, or a secret, or the host is taken from model arguments.
- A `proxy` child process inherits the gateway environment, or its server package is not pinned to an exact version.
- The admin API is reachable on the MCP port, or accepts a mutation without `Content-Type: application/json`.
- Behavior outside the delta: a route, tool, or connector the change does not specify.
- A delta requirement is unimplemented, or its scenario has no test.
- A new or changed server module, component, hook, or helper has no tests.
- A test was weakened or removed to make it pass.
- `mcp-gateway-spec.md` or `openspec/specs/` changed during apply.
- A commit on the branch contains `.env`, a key, the data directory, or a real secret.
- A new or changed file introduces explicit `any`, or the change breaks the repository ESLint / Prettier contract (`npm run lint` or `npm run format:check` would fail).

## Note

- Architecture drift: logic in an Express route, a service that imports Express or reads `process.env`, a module-level singleton.
- Frontend drift: a dumb component that fetches, Radix imported outside `shared/ui`, domain names in `shared/ui`, styles outside a CSS module, raw values instead of tokens.
- Test drift: queries by test id where a role exists, asserting internal state, whole-tree snapshots, real sleeps.
- Naming, file structure, ordinary style notes that do not break the ESLint / Prettier contract.

A note does not block archive. Raise a note to a blocker only when it breaks a law in `AGENTS.md`.

Write the review into the Review section of `verification.md`, in the form defined by the validator agent. Do not edit the code.
