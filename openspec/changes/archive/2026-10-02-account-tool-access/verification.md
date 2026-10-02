# account-tool-access

## Result
blockers: 0

## Spec
- Delete account removes it from configurations: met
- Assign accounts to a configuration: met
- Read and replace disabled tools for an assigned account: met
- Enable or disable tools for an assigned account: met
- Configuration disabledTools denylist: met
- List connectors public description: met
- tools/list from eligible accounts only: met
- Injected account argument in tool schemas: met
- tools/call validates, authorizes, then invokes handler: met
- Proxy tools/list from the in-code allowlist: met
- Proxy tools/call strips account and calls the child by short name: met

## Checks
- tests: passed — 407 server + 51 web (458 total). All 6 tasks are checked. Each delta scenario name is a Vitest `it` title.
- type check: passed
- lint: passed
- format check: passed
- build: passed

## Review
- note: `PUT` of `{ "toolNames": [] }` stores that account key as an empty array in `replaceDisabledToolNames` (`server/src/configurations/service.ts`). GET returns `{ "toolNames": [] }` and MCP treats the account as fully enabled, which matches the delta. The design sentence that an empty array clears the denylist describes a missing key; the stored key remains.
- note: `git diff origin/main...HEAD` does not change `mcp-gateway-spec.md` or `openspec/specs/`. No new MCP tool. Public configuration JSON omits `disabledTools`, `token`, and `tokenHash`. Connector `tools` are `{ name, description }` only. The disabled-tool check runs before schema validation and does not start a handler or a proxy child.
- note: the admin page logs `favicon.ico` 404. Unrelated to this delta.

## E2E
- Admin configurations empty state: passed — heading `Configurations`; text `No configurations yet. Create one to get a bearer token.`; Create disabled
- Create configuration and dismiss the bearer dialog: passed — dialog title `Bearer token`; after `Close` the token was absent from the DOM and from input values
- Unassigned account has no tool toggles: passed — `Box` and `Spare` were assignment checkboxes; `fake_drop` was not shown; no `disabled-tools` request
- Assigned account lists tools and a toggle replaces the set: passed — inside assigned `Box`: `fake_keep`, `Keep a row`, `fake_drop`, `Drop a row`; `Spare` stayed a checkbox only; one GET `disabled-tools` for `Box`; turning `fake_drop` off sent `PUT` `Content-Type: application/json` body `{ "toolNames": ["fake_drop"] }` and the checkbox cleared
- Turning a tool back on sends an empty set: passed — the next `PUT` body was `{ "toolNames": [] }` and `fake_drop` was checked again
- Failed toggle shows English error without secrets: passed — after the account was unassigned in the store, turning `fake_drop` off showed alert `Bad Request`; the checkbox stayed checked; the document had no fixture secret and no bearer
- Missing denylist lists every tool for the assigned account: passed — `tools/list` included `fake_keep` and `fake_drop`; `account` enum was that account id; fixture secret absent (`e2e/mcp-client.mjs`)
- Tool omitted when every assigned account has it disabled: passed — `fake_keep` listed, `fake_drop` absent
- Same account on another configuration still lists the tool: passed — configuration B `tools/list` included `fake_drop` with that account id in `account.enum`
- Disabled account is omitted from that tool enum only: passed — `fake_drop` enum was the other account only; `fake_keep` enum had both ids; the drop description did not contain the disabled account id
- Disabled tool returns the fixed error and does not call the handler: passed — message `Tool is disabled for this account`; not `Invalid tool arguments`; `fake_keep` succeeded; drop call count stayed 0 and keep became 1
- Foreign account refuses without calling handler: passed — `Invalid tool arguments`; keep call count unchanged
- Disabled account refuses without calling handler: passed — `Account is not allowed for this tool`; keep call count unchanged
- gmail_delete_message off on one configuration leaves the other path working: passed — configuration A returned `Tool is disabled for this account` with no new fake IMAP session; `gmail_list_mailboxes` succeeded and contained `INBOX`; configuration B `gmail_delete_message` succeeded and contained `Deleted Items`; fixture password absent
- Disabled proxy tool is absent when no account may use it: passed — `stdiofake_echo_args` absent, `stdiofake_leak_secret` listed, launch count unchanged; the call returned `Tool is disabled for this account` and the launch count stayed unchanged
- Empty and unknown bearer identical rejection: passed — both 401 with the same body
- MCP vs admin port separation: passed — admin `/mcp` 404; MCP `/api/connectors` 404
- UI harness MCP after the toggle path: passed — with `fake_drop` disabled, `tools/list` was only `fake_keep`; the call returned `Tool is disabled for this account`; calls file was `keep` 1 and `drop` 0

No live connector host was contacted. The fake native connector, the Gmail fake IMAP transport, and the fake stdio proxy backed the calls.

## Leaks
- admin UI DOM on Configurations, including after the bearer dialog closed: clean
- admin UI DOM on Connectors after create: clean
- admin UI input values after create and after the failed toggle: clean
- admin API accounts list, connectors list, configurations list, and the 400 toggle body: clean
- MCP tools/list and tools/call results, including the Gmail success path: clean
- MCP error text: clean
- browser console (aside from favicon 404 and the expected 400 on the failed toggle): clean
