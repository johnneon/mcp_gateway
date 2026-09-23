---
name: tests
description: Turns OpenSpec scenarios into MCP Gateway automated tests on fakes, without live providers. Use when adding or changing tests, fakes, or coverage for a change's Given/When/Then scenarios.
---

# Tests

Each scenario in the change delta becomes an automated test. The test name includes the requirement id.

## How to write

- Use the test runner already in the repository. If none exists yet, use `node:test`.
- Put server tests in `server/test`.
- Replace an external provider with a fake. The fake counts outbound connections.
- A rejection before the provider call is proven when the connection count stays 0.
- Do not call live connector hosts.
- A secret planted in a provider response fixture must not reach the client, the activity log, or the admin API. Add that test when the change touches responses.

## Do not weaken tests

Do not delete or weaken an assertion to make a test pass. Fix the product code. If a scenario in the spec is wrong, stop and tell the person: propose or update changes the spec, a test does not.
