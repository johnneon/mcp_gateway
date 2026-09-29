# native-egress-guard

## Result
blockers: 0

## Spec
- Resolve allowed destinations for an account: met
- Egress client refuses disallowed destinations before I/O: met
- HTTPS request and TLS connect operations: met
- Never follow redirects: met
- Timeout and max response size constants: met
- Network errors are short English phrases without bodies: met
- Native connector tools (handler receives egress; checkConnection does not): met
- tools/call validates, authorizes, then invokes handler (egress build, distinct network errors): met
- Scrub secret account values from tool results and errors: met

## Checks
- tests: passed — server 189, web 45 (234 total)
- type check: passed
- lint: passed
- format check: passed
- build: passed

## Review
- note: production connector registry remains empty; fake tools and fake transport live only in tests and the e2e throwaway client.
- note: default HTTPS transport builds an internal URL from host/port/path for `fetch`; model arguments still carry no URL, host, or secret.
- note: no admin UI or `web/` changes in this diff; browser walk skipped per proposal and design.

## E2E
- Admin UI screens: skipped — no screen changed (proposal non-goal).
- Successful call passes egress client to handler: passed — handler recorded `httpsRequest` and `tlsConnect`; fixture secret seen by handler only; MCP result clean (`e2e/mcp-fake-client.mjs`).
- Handler receives egress client; checkConnection does not: passed — egress present on tools/call; `checkConnection` invoked with one argument.
- Egress Destination is not allowed reaches the MCP client unchanged: passed — MCP error exactly `Destination is not allowed`, not `Tool execution failed`; fixture secret absent.
- Foreign account refuses without calling handler: passed — call count 0; short English MCP error; secret absent.
- Disabled account refuses without calling handler: passed — call count 0; short English MCP error; secret absent.
- Secret returned in the body is redacted in the tool result: passed — result contains `[redacted]`; fixture secret absent.
- Longer secret is redacted before a shorter overlapping secret: passed — `abc` fully redacted; no `[redacted]c` leftover.
- Empty secret and non-secret fields are not redacted: passed — `visible-text` and `mail.example.test` remain; no `[redacted]`.
- Secret in error text is scrubbed before the client sees it: passed — fixed `Tool execution failed`; fixture secret and exception text absent.
- Empty and unknown bearer: passed — identical `401 Unauthorized`.
- MCP port does not serve admin API / admin does not answer MCP: passed — `/api/connectors` on MCP 404; `/mcp` on admin 404; live `/health` ok.
- Live provider: not exercised — fake only, as required.

## Leaks
- tools/call success result (fake e2e): clean
- tools/call egress and handler-throw errors (fake e2e): clean
- empty/unknown bearer refusal bodies: clean
- production `/health` JSON: clean
- automated tests (fixture secrets asserted absent from MCP responses): clean
