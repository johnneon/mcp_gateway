# Design

## Context

See `proposal.md` — Why. Configurations already persist `{ id, name, tokenHash, enabled, accountIds }` in the encrypted document. `PUT /api/configurations/:id/accounts` replaces `accountIds`. Account delete already strips that id from every `accountIds` array. `GET /api/connectors` returns `{ id, name, kind, fields }` from `toPublicConnector` and drops tools. MCP builds `tools/list` in `listToolsForConfiguration` from accounts that are assigned, present, enabled, and on that connector, then injects an `account` enum of those ids. `dispatchToolCall` validates arguments with that enum before it checks the account, so an id missing from the enum becomes `Invalid tool arguments`. Native and proxy calls share that path. The Configurations screen assigns accounts with checkboxes and does not list tools.

## Goals / Non-Goals

**Goals:**

- Persist a per-configuration, per-account denylist and apply it on `tools/list` and `tools/call` for native and proxy tools.
- Expose connector tool names to the admin API and toggles on the Configurations screen.
- Leave rows that have no `disabledTools` property behaving as they do today.

**Non-Goals:**

- See `proposal.md` — Non-goals. No new MCP tool, no change to whole-account or whole-configuration disable, no allowlist, no runtime catalog.

## Decisions

Accepted by the person before propose. They are not reopened here. No open questions remain for this change.

### 1. Denylist on the configuration row

```text
disabledTools?: { [accountId: string]: string[] }
```

Values are MCP names from `mcpToolName` (`gmail_delete_message`). Absent property, absent key, or `[]` means every tool of that connector is enabled. Do not store the complement as an allowlist. A name that is not in the array stays enabled, including a tool added in code later.

`ActiveConfiguration` in `server/src/mcp/auth.ts` reads the map the same way it reads `accountIds`: a missing or non-object property becomes an empty map; a non-array value becomes `[]`. Public configuration JSON (`toPublic`) does not include `disabledTools`, `token`, or `tokenHash`. Create still writes no `disabledTools` property.

**Alternative (rejected):** an allowlist of enabled tools. Rejected; a new tool would stay off until the operator opted in, and existing rows would change behavior.

**Alternative (rejected):** one denylist on the account, shared by every configuration. Rejected; the same account on another configuration stays unchanged.

### 2. Admin routes

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/api/connectors` | Add `tools: [{ name, description }]`. `name` is the MCP tool name. No input schema, handler, destinations, secrets, or account values. |
| GET | `/api/configurations/:id/accounts/:accountId/disabled-tools` | `{ toolNames }` stored for that key, or `[]`. |
| PUT | `/api/configurations/:id/accounts/:accountId/disabled-tools` | Body `{ toolNames: string[] }` replaces that key. |

PUT rules, matching the accounts-api delta: the account must be in `accountIds`; every name must be an MCP tool of that account's connector; duplicates and empty strings are 400 with no write; empty array clears the denylist for that account; unknown configuration is 404; non-JSON is 415. Preserve submitted order. Unknown JSON properties are ignored, as the existing account-assignment body parser does.

`setAccountIds` keeps `disabledTools` keys whose ids remain and deletes keys that were removed. `removeAccountIdFromAll` deletes that account's key on every configuration while it removes the id from `accountIds`. A later assign does not recreate the key.

### 3. MCP filter before schema validation

For each tool, start from the current eligible-account list and drop accounts whose denylist contains that MCP name. Preserve `accountIds` order. If the remaining list is empty, omit the tool. The `account` enum and description use only the remaining ids.

On `tools/call`, before Ajv runs, if `account` is a string, the account is otherwise eligible (assigned, exists, enabled, connector matches), and the MCP name is in that account's denylist, return `Tool is disabled for this account` and do not call the handler or start a proxy child. Do this even though the id is absent from the enum, so the client does not only get `Invalid tool arguments`. Other refusals stay on their current messages: unknown tool, account not allowed, invalid arguments, egress phrases, `Tool execution failed`.

There is no new MCP tool. Whole-account `enabled: false` and whole-configuration disable stay on their current paths.

**Alternative (rejected):** rely on the enum so a disabled account fails schema validation. Rejected; the person locked the fixed English error.

### 4. Configurations screen

Inside each account that is in `accountIds`, after the connectors list is loaded, render that connector's `tools` with the MCP name and description and a control per tool. Load `GET .../disabled-tools` only for assigned accounts. A control change PUTs the full replacement array of names that are off after the change. Unassigned accounts stay checkboxes only. Copy is English. Do not render a bearer or a secret. Show the existing short English error path when the PUT fails.

## Risks / Trade-offs

- [A stored name whose tool later leaves the connector] → GET still returns the stored names. PUT of that name is 400. MCP ignores it because the tool is not registered. The operator replaces the set to clear it.
- [Ajv enum check runs first today] → The disabled-account check has to run before schema validation. A test calls the disabled tool with otherwise valid arguments and asserts the fixed message, not `Invalid tool arguments`.
- [Public list stays without `disabledTools`] → The screen uses the dedicated GET. List, create, patch, and rotate responses stay free of the denylist and the bearer.

## Migration Plan

No startup rewrite. Rows without `disabledTools` read as all tools enabled. Rollback is the previous build: it ignores an unknown `disabledTools` property on configuration rows if it only reads known fields. Do not add a version key.
