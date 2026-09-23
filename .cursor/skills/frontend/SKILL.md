---
name: frontend
description: Builds the MCP Gateway admin UI with React and Vite in the same process as the server. Use when editing web/, admin screens, admin session UI, or static assets served by the gateway.
---

# Frontend

The admin UI is React and Vite in `web/`. There is no UI kit and no separate frontend service. The server process serves the production static build.

Screen behavior comes from the accepted change. This skill does not list connectors.

## Interface

- UI copy is English.
- The admin session cookie is `HttpOnly` and `SameSite=Lax`.
- The raw bearer is shown once, on create and on rotate.
- A connector secret never appears on screen: not after save, not in the activity log, not in an error.
- When a change shows the activity log, the log has no request or response bodies.

## Check

After changing a screen, exercise it in the browser: open, submit, empty state, error state. Use the `e2e` skill when the change is already with the validator. Do not act as the validator.
