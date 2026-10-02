# Spec Delta

## ADDED Requirements

### Requirement: Enable or disable tools for an assigned account

On the Configurations screen, inside each account whose id is in that configuration's `accountIds`, the UI SHALL list that account's connector tools from `GET /api/connectors` and SHALL show each tool's MCP `name` and `description`. Each tool SHALL have an enable or disable control. A tool is shown enabled when its name is absent from that account's disabled-tool set. The screen SHALL load the set with `GET /api/configurations/:id/accounts/:accountId/disabled-tools`. Changing a control SHALL immediately send `PUT /api/configurations/:id/accounts/:accountId/disabled-tools` with `Content-Type: application/json` and body `{ "toolNames": <full replacement list> }` containing every tool name that is disabled after the change. Copy SHALL be English. The screen SHALL NOT show a bearer token, a token hash, or an account secret. An account that is not in that configuration's `accountIds` SHALL NOT show tool controls and SHALL NOT cause a disabled-tools request.

#### Scenario: Assigned account lists tools and a toggle replaces the set

- **GIVEN** configuration `c1` is listed with `accountIds` `["a1"]`
- **AND** account `a1` has connector `fake` and label `Box`
- **AND** `GET /api/connectors` returns a connector `fake` whose `tools` are `{ "name": "fake_keep", "description": "Keep a row" }` and `{ "name": "fake_drop", "description": "Drop a row" }`
- **AND** `GET /api/configurations/c1/accounts/a1/disabled-tools` returns `{ "toolNames": [] }`
- **AND** `PUT /api/configurations/c1/accounts/a1/disabled-tools` will return `{ "toolNames": ["fake_drop"] }`
- **WHEN** the Configurations screen loads and the operator turns off `fake_drop` for account `Box`
- **THEN** the screen shows `fake_keep`, `Keep a row`, `fake_drop`, and `Drop a row` inside that assigned account
- **AND** the UI sends `PUT /api/configurations/c1/accounts/a1/disabled-tools` with `Content-Type: application/json` and body `{ "toolNames": ["fake_drop"] }`
- **AND** the document does not contain a bearer token or an account secret

#### Scenario: Turning a tool back on sends an empty set

- **GIVEN** configuration `c1` lists assigned account `a1` and the disabled-tools GET returns `{ "toolNames": ["fake_drop"] }`
- **AND** `PUT /api/configurations/c1/accounts/a1/disabled-tools` will return `{ "toolNames": [] }`
- **WHEN** the operator turns `fake_drop` on
- **THEN** the UI sends `PUT /api/configurations/c1/accounts/a1/disabled-tools` with body `{ "toolNames": [] }`

#### Scenario: Unassigned account has no tool toggles

- **GIVEN** configuration `c1` is listed with `accountIds` `[]`
- **AND** account `a1` labeled `Box` is listed under connector `fake`, and that connector has tool `fake_drop`
- **WHEN** the Configurations screen loads
- **THEN** the account `Box` is shown as an assignment checkbox
- **AND** the tool name `fake_drop` is not shown as a tool control
- **AND** no request is sent to a `disabled-tools` path

#### Scenario: Failed toggle shows English error without secrets

- **GIVEN** an assigned account is showing tool `fake_drop` as enabled
- **AND** `PUT` to that account's `disabled-tools` path will return status 400 with a short English body
- **WHEN** the operator turns `fake_drop` off
- **THEN** an English error message is visible
- **AND** the document does not contain a bearer token or an account secret
