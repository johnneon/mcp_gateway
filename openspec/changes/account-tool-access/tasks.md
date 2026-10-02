# Tasks

## 1. Configuration denylist

- [x] 1.1 Extend the configuration record so an optional `disabledTools` map is read and written. A missing property, a missing account key, or an empty array means every tool is enabled. New creates write no `disabledTools` property. Public configuration JSON omits `disabledTools`, `token`, and `tokenHash`. `setAccountIds` drops keys for account ids removed from the list and keeps keys that remain. `removeAccountIdFromAll` drops that account's key on every configuration. `ActiveConfiguration` carries the same map for MCP. Unit tests cover a missing property, create without the property, unassign then assign again with no key, and delete cascade of the key. Check: configurations and accounts service tests for those scenarios pass; `npm run typecheck -w server` exits 0.

## 2. Connector tool names on the admin list

- [x] 2.1 Add `tools: [{ name, description }]` to the public connector object. `name` is the MCP tool name. Do not include input schemas, handlers, allowed destinations, secrets, or account values. Update connectors-api tests that assert the public shape so they expect `tools` as in the delta, without weakening the existing assertions that destinations and secrets stay out of the body. Check: connectors-api tests pass, including the fake connector scenario whose tool is `fake_drop` with description `Drop a row`.

## 3. Disabled-tools admin routes

- [x] 3.1 Mount `GET` and `PUT /api/configurations/:id/accounts/:accountId/disabled-tools` on the admin app. PUT body `{ toolNames: string[] }` replaces the whole set in stored order. The account must be in `accountIds`. Every name must be an MCP tool of that account's connector. Duplicates, empty strings, unknown names, and an unassigned account are 400 with no write. Unknown configuration is 404. Empty array enables every tool. Non-JSON PUT is 415 with no write. Responses contain no bearer and no account secret. HTTP tests cover every added and modified scenario in `accounts-api` and the denylist scenarios in `configurations-api`. Check: those HTTP tests pass.

## 4. MCP list and call

- [x] 4.1 Filter `tools/list` per tool for native and proxy connectors: omit an account from that tool's `account` enum when the tool is in its denylist, and omit the tool when no account remains. On `tools/call`, before schema validation, an otherwise eligible account with that tool disabled returns exactly `Tool is disabled for this account` and does not call the handler or start a proxy child. A missing denylist still lists and calls every tool. Whole-account and whole-configuration disable stay as they are. Do not add an MCP tool that reads or writes the switches. Tests use fakes, not a live provider, and cover the delta scenarios in `mcp-endpoint`, including `gmail_delete_message` off for one Gmail account on one configuration with a fake IMAP transport: that bearer cannot call it, `gmail_list_mailboxes` for that account still succeeds, and the same account on the other configuration can still call `gmail_delete_message`. Check: MCP endpoint tests for those scenarios pass.

## 5. Configurations screen toggles

- [ ] 5.1 On the Configurations screen, inside each assigned account, list that connector's tools by MCP name and description and toggle each one. A toggle immediately PUTs the full replacement `{ toolNames }` set. Load the set only for assigned accounts. Unassigned accounts show no tool controls and cause no disabled-tools request. Copy is English. The screen shows no bearer and no secret. A failed PUT shows a short English error. Cover the delta scenarios with React Testing Library component tests. Check: Configurations screen tests pass; `npm run typecheck -w web` exits 0.

## 6. Full package check

- [ ] 6.1 From the repository root, `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`, and `npm run build` exit 0. Do not edit `mcp-gateway-spec.md` or `openspec/specs/`. Check: every command exits 0.
