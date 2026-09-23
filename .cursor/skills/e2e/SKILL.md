---
name: e2e
description: Walks an MCP Gateway change through the admin UI in a browser and through an MCP client, and looks for secrets on screen. Use when running end-to-end or visual checks of admin UI and MCP tools for a change.
---

# E2E

Check the scenarios in the change delta, not an imagined product. The provider is the fake from the change. Do not call a live connector host.

## Setup

1. Start the process the way this change's design describes. If that command does not exist yet, record a blocker. Do not invent a production server.
2. Use credentials only from the change fixture. Do not ask for or insert a real secret.
3. Admin UI goes through the browser. MCP goes through an HTTP client on `/mcp` with a bearer.

## What to walk

- Every delta scenario that an operator or an MCP client can see.
- Screens the change added or changed: the main path, the empty state, and the error state.
- A foreign account id does not call the connector.
- An empty bearer and an unknown bearer look the same.

## Leaks

The fixture secret is absent from the DOM, the admin API JSON, the MCP body, the error text, and the activity-log row. After the create screen is dismissed, the raw bearer is not returned again.

Record a failed scenario as a blocker. Do not fix the product.
