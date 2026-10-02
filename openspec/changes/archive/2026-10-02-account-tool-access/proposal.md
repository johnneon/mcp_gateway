# Proposal

Issue: #50

## Why

A configuration bearer currently offers every tool of every assigned account. The operator cannot turn off one tool, such as `gmail_delete_message`, for one Gmail account on one configuration while leaving that account's other tools and the same account on another configuration unchanged.

## What Changes

- On each configuration, store a denylist `disabledTools` keyed by account id. Values are MCP tool names (`<connector id>_<short tool name>`, for example `gmail_delete_message`). A missing key or an empty array means every tool of that connector is enabled. Existing configurations keep current behavior. A tool added to a connector later stays enabled until the operator turns it off. The store does not keep an allowlist.
- `GET /api/connectors` adds `tools: [{ name, description }]` on each connector. `name` is the MCP tool name. The response has no input schemas, handlers, allowed destinations, secrets, or account values.
- `GET` and `PUT /api/configurations/:id/accounts/:accountId/disabled-tools`. The PUT body is `{ toolNames: string[] }` and replaces the whole set. The account must be in that configuration's `accountIds`. Every name must be an MCP tool of that account's connector; otherwise the response is 400 and nothing is written. An empty array means all tools are enabled. GET returns the stored names, or `[]` when nothing is stored.
- Unassigning an account from a configuration, or deleting the account, drops that account's `disabledTools` entry. Assigning the account again starts with all tools enabled.
- On the Configurations screen, inside each assigned account, list that connector's tools and let the operator enable or disable each one. A toggle immediately replaces the disabled-tool set. Copy is English. The screen shows no secrets and no bearer. Unassigned accounts do not show tool toggles.
- MCP: an account is eligible for a tool only when that tool is enabled for the account. The account is omitted from that tool's `account` enum. If no account on the configuration may use the tool, the tool is absent from `tools/list`. `tools/call` when the account is otherwise eligible but the tool is disabled for it returns the fixed English error `Tool is disabled for this account` and does not call the connector. That check runs even when the account is already absent from the enum, so the client does not only get `Invalid tool arguments`. The model cannot change these switches. There is no MCP tool for it. Disabling a whole account or a whole configuration stays as it is.

When the product vision and this accepted approach differ, this approach wins for the duration of the change. The vision lists every enabled assigned account on every tool; this change narrows the `account` enum per tool.

## Non-goals

- Model-controlled switches, or an MCP tool that reads or writes them.
- Changing whole-account or whole-configuration disable.
- A runtime connector catalog.
- Secrets or a bearer on the admin screen or in API responses.
- An allowlist of enabled tools.
- Edits to `mcp-gateway-spec.md` or `openspec/specs/` during apply.

## Capabilities

### New Capabilities

- (none)

### Modified Capabilities

- `configurations-api`: Optional `disabledTools` denylist on the configuration document. Missing key or empty array means every tool is enabled. Public configuration responses stay free of the bearer and of secrets.
- `accounts-api`: Read and replace one account's disabled-tool set on one configuration. Unassign and account delete drop that account's entry.
- `connectors-api`: `GET /api/connectors` includes each connector's MCP tool name and description.
- `mcp-endpoint`: Per-tool account eligibility on `tools/list` and `tools/call`, including proxy tools, with the fixed English refusal and no connector call.
- `admin-configurations-ui`: Tool enable and disable toggles inside each assigned account on the Configurations screen.

## Impact

- Encrypted configuration rows gain an optional `disabledTools` map. Reads of older rows treat a missing map as all tools enabled.
- Admin API: connectors list, new disabled-tools routes, and cleanup inside account assignment and account delete.
- MCP `tools/list` and `tools/call` for native and proxy tools filter by that map before the connector or child process runs.
- Configurations screen loads connector tools and the stored denylist, and writes the full set on each toggle.
- Automated tests cover the default, admin read and write, the screen toggle, and MCP list and call, including `gmail_delete_message` off for one account on one configuration.
