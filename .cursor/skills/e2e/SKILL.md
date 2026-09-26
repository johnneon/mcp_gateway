---
name: e2e
description: Walks an MCP Gateway change through the admin UI with Playwright MCP and through an MCP client, and looks for secrets on screen and in responses. Use when running end-to-end or visual checks of admin UI and MCP tools for a change.
---

# E2E

Check the scenarios in the change delta, not an imagined product. The provider is the fake from the change. Do not call a live connector host.

## Setup

1. Start the process the way this change's design describes, with a fresh temp data directory and a test encryption key. If that command does not exist yet, record a blocker. Do not invent a production server.
2. Use credentials only from the change fixture. Do not ask for or insert a real secret.
3. Admin UI goes through Playwright MCP on the admin port. MCP goes through an MCP client on `/mcp` of the MCP port.
4. Before the first browser step, list the Playwright MCP tools with `GetDynamicTools`. If the server is unavailable or needs auth, record a blocker "Playwright MCP unavailable" and still run the MCP part.

## Admin UI with Playwright MCP

Work from the accessibility snapshot, not from coordinates.

| Step | Tool |
| --- | --- |
| open a screen | `browser_navigate` |
| read the page and get element refs | `browser_snapshot` |
| click, type, fill a form, choose an option | `browser_click`, `browser_type`, `browser_fill_form`, `browser_select_option` |
| wait for text or a state | `browser_wait_for` |
| read the DOM and input values | `browser_evaluate` |
| check requests and console errors | `browser_network_requests`, `browser_console_messages` |
| keep evidence of a failure | `browser_take_screenshot` |
| finish | `browser_close` |

For each changed screen walk the main path, the empty state, and the error state. After each step take a new `browser_snapshot` before the next action; refs from an old snapshot are stale.

A console error or a failed request that the scenario does not expect is a blocker.

## MCP client

Use `Client` and `StreamableHTTPClientTransport` from `@modelcontextprotocol/sdk` in a throwaway script outside `server/src`. Do not add it to the product.

- `tools/list` with a bearer for each configuration the scenario needs.
- `tools/call` for the delta tools, including a foreign and a disabled `account`.
- An empty bearer and an unknown bearer get the same rejection.
- The MCP port does not serve the admin API, and the admin port does not answer MCP.

## What to walk

- Every delta scenario that an operator or an MCP client can see.
- A foreign or disabled account does not call the connector: the fake's connection count stays 0.

## Leaks

The fixture secret must be absent from:

- the DOM and every input value: `browser_evaluate` over `document.documentElement.outerHTML` and all `input`, `textarea` values;
- the admin API JSON;
- the MCP response body and error text;
- the browser console.

After the create or rotate dialog is dismissed, the raw bearer is not on screen and is not returned by the API again.

## Report

Each scenario is `passed` or `failed — <what was visible>` in the E2E section of `verification.md`. A failure is a blocker. Save its screenshot in `openspec/changes/<name>/e2e/` and reference the file. Do not fix the product.
