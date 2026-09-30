# proxy-tools

## Result
blockers: 0

## Spec
- Proxy connector tool allowlist: met
- Registry build validates modules: met
- Native connector module shape: met
- Proxy tools/list from the in-code allowlist: met
- Proxy tools/call strips account and calls the child by short name: met
- Proxy tool result scrubs secrets and omits stderr: met
- Production registry has no proxy connector: met
- Fake stdio server echo and leak tools: met

## Checks
- tests: passed — server 245, web 45
- type check: passed
- lint: passed
- format check: passed
- build: passed

## Review
- note: `web/` is unchanged. The admin shell logs a 404 for `/favicon.ico`.
- note: a foreign `account` outside the eligible enum is an MCP error `Invalid tool arguments` and does not start the child. A disabled account is `Account is not allowed for this tool` and does not start the child.
- note: `server/src/main.ts` passes `process.env` into `createProxyRuntime` as `parentEnv`. The runtime does not read `process.env`. `buildChildEnv` still copies only `PATH`, `SYSTEMROOT` on Windows, and the mapped account variables.

## E2E
- Production registry includes Gmail and no proxy connector: passed — Connectors showed "Gmail" and "No accounts yet."; `GET /api/connectors` returned `id` `gmail`, `kind` `native`, and no `proxy` connector.
- Allowlisted tools are listed with prefix and account and list starts no child: passed — injected client listed `stdiofake_echo_args` and `stdiofake_leak_secret`; `account` was required, its enum was only `acc-ok`, and the description contained `acc-ok (Proxy box)`; launch count stayed 0; the fixture secret was absent from the schema.
- Tools off the allowlist do not appear: passed — `stdiofake_report_env` and `stdiofake_crash` were absent; launch count stayed 0.
- No eligible account hides proxy tools: passed — `tools/list` for the configuration with no account ids returned no tools.
- echo_args receives arguments without account: passed — result JSON was `{"note":"hello"}` with no `account` property; launch count was 1.
- Allowlist schema rejects a call the child would accept: passed — missing `note` returned `Invalid tool arguments`; launch count stayed 0.
- Ineligible account does not start the child: passed — the configuration that does not include the account returned `Account is not allowed`; launch count stayed 0.
- Non-allowlisted tool name does not start the child: passed — `stdiofake_report_env` returned `Unknown tool`; launch count stayed 0.
- Secret in the result is redacted and the stderr marker is absent: passed — `stdiofake_leak_secret` text contained `[redacted]` and did not contain the fixture secret or `fake-stdio-mcp-stderr-marker`.
- Foreign account does not start the child: passed — `Invalid tool arguments`; launch count stayed 0.
- Disabled account does not start the child: passed — `Account is not allowed`; launch count stayed 0.
- Empty bearer and unknown bearer: passed — a missing header, `Bearer ` with an empty token, and an unknown bearer were all 401 with body `Unauthorized` on the injected app and on the production MCP port.
- MCP port does not serve the admin API: passed — `GET /api/connectors` on the MCP port returned 404 `Not Found`.
- Admin port does not answer MCP: passed — `POST /mcp` on the admin port returned 404 `Not Found`.
- Bearer is shown once: passed — the "Bearer token" dialog was visible, and after Close the dialog was gone. `GET /api/configurations` returned `id`, `name`, `enabled`, and `accountIds` only.
- Production MCP has no proxy tools: passed — `tools/list` for a configuration with no accounts returned no tools. `stdiofake_echo_args`, `stdiofake_leak_secret`, and `report_env` returned `Unknown tool`. `gmail_list_messages` returned `Account is not allowed for this tool`.

Registry-build scenarios and the fake's own `echo_args` and `leak_secret` scenarios are not on the admin UI or the production MCP port. Their tests passed. Add account was opened and canceled; Create was not used, so the check did not contact a live host.

## Leaks
- Connectors DOM and input values after the dialogs closed: clean
- Admin connectors JSON, accounts JSON, and configuration list JSON: clean
- Injected MCP `tools/list` schema, `tools/call` result, and error text: clean
- Production MCP `tools/list`, error text, `/health`, and 401 bodies: clean
- Browser console: clean
