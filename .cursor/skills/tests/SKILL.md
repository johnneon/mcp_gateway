---
name: tests
description: Turns OpenSpec delta scenarios into MCP Gateway automated tests on fakes, without live providers. Use when a change adds or changes a Given/When/Then scenario, or when checking that every scenario is covered.
---

# Tests

Each scenario in the change delta becomes an automated test, written in the same task as the code. This skill covers the scenario rules. How to write the test depends on where it lives:

- `server/` — the Testing section of `backend`;
- `web/` — `frontend-cover-tests`.

## Scenario rules

- The test runner is Vitest in both workspaces.
- The test name includes the requirement id and the scenario name.
- One scenario is at least one test. A scenario that crosses server and UI gets a server test for the behavior and a component test for what the operator sees.
- Given becomes setup, When becomes one action, Then becomes assertions.
- Replace an external provider with a fake. The fake counts outbound connections.
- A rejection before the provider call is proven when the connection count stays 0.
- Do not call live connector hosts.
- A secret planted in a provider response fixture must not reach the MCP response, the MCP error, the admin API, or the screen. Add that test when the change touches responses.

## Do not weaken tests

Do not delete or weaken an assertion to make a test pass. Fix the product code. If a scenario in the spec is wrong, stop and tell the person: propose or update changes the spec, a test does not.
