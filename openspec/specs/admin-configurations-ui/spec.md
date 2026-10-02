# admin-configurations-ui Specification

## Purpose

Defines the English admin UI shell with Configurations and Connectors navigation, configuration management against the existing admin API, one-time bearer reveal, and an empty Connectors screen, with no login.

## Requirements

### Requirement: Admin shell with Configurations and Connectors

The admin UI SHALL present an English application shell with navigation items named Configurations and Connectors. Selecting a navigation item SHALL switch the visible screen in application state without a client-side URL router. The product SHALL NOT present a login screen. UI copy SHALL be English.

#### Scenario: Shell shows both navigation items and no login

- **GIVEN** the admin UI is rendered
- **WHEN** the operator views the shell
- **THEN** navigation includes Configurations and Connectors
- **AND** no login form or login prompt is shown

#### Scenario: Switching screens does not use a client router

- **GIVEN** the admin UI is on the Configurations screen
- **WHEN** the operator selects Connectors
- **THEN** the Connectors screen is visible
- **AND** the document location path does not change as a result of that selection

### Requirement: List configurations without tokens

On the Configurations screen the UI SHALL load configurations with `GET /api/configurations` and display each configuration's `name` and `enabled` state. The list view SHALL NOT receive or render a bearer `token` or a `tokenHash`. When the list is empty, the UI SHALL show an English empty state.

#### Scenario: Empty list

- **GIVEN** `GET /api/configurations` returns an empty array
- **WHEN** the Configurations screen loads
- **THEN** an English empty state is shown
- **AND** no bearer token text is present in the document

#### Scenario: List shows name and enabled without secrets

- **GIVEN** `GET /api/configurations` returns `[{ "id": "c1", "name": "Ops", "enabled": true }]`
- **WHEN** the Configurations screen loads
- **THEN** the list shows the name `Ops` and that the configuration is enabled
- **AND** the document does not contain the strings `token` or `tokenHash` as field values from the API response

### Requirement: Create configuration and reveal token once

The Configurations screen SHALL create a configuration with `POST /api/configurations` and JSON body `{ "name": <trimmed non-empty name> }` and header `Content-Type: application/json`. On success the UI SHALL open a reveal dialog that shows the response `token` once. Closing the reveal dialog SHALL clear that plaintext token from UI state so it is no longer present in the document. The list SHALL be refreshed after a successful create and SHALL NOT include the token.

#### Scenario: Create shows the token in the reveal dialog

- **GIVEN** the Configurations screen is open and `POST /api/configurations` will return status 201 with a `token` string `tok-create-once`
- **WHEN** the operator creates a configuration named `Primary`
- **THEN** the UI sends `POST /api/configurations` with `Content-Type: application/json` and body including `"name":"Primary"`
- **AND** a dialog shows the text `tok-create-once`

#### Scenario: Token is gone after the reveal dialog closes

- **GIVEN** the create reveal dialog is open and shows token `tok-create-once`
- **WHEN** the operator closes the reveal dialog
- **THEN** the document no longer contains `tok-create-once`
- **AND** the configurations list does not show that token string

### Requirement: Confirm before rotate and delete

Rotate and delete SHALL require an explicit confirmation step before the mutation request is sent. After a confirmed rotate, the UI SHALL call `POST /api/configurations/:id/rotate` with `Content-Type: application/json`, then open the same style of one-time reveal dialog with the new `token`, and clear that token from UI state when the dialog closes. After a confirmed delete, the UI SHALL call `DELETE /api/configurations/:id` with `Content-Type: application/json` and remove the configuration from the list on success.

#### Scenario: Rotate requires confirmation then shows the new token

- **GIVEN** a configuration `c1` is listed and `POST /api/configurations/c1/rotate` will return a new token `tok-rotated`
- **WHEN** the operator chooses rotate and confirms
- **THEN** the UI sends `POST /api/configurations/c1/rotate` with `Content-Type: application/json`
- **AND** a dialog shows `tok-rotated`
- **AND** when the dialog is closed, `tok-rotated` is absent from the document

#### Scenario: Rotate without confirmation does not call the API

- **GIVEN** a configuration is listed
- **WHEN** the operator chooses rotate and dismisses the confirmation without confirming
- **THEN** no `POST` to a rotate path is sent

#### Scenario: Delete requires confirmation then removes the row

- **GIVEN** a configuration `c1` named `Ops` is listed and `DELETE /api/configurations/c1` will return status 204
- **WHEN** the operator chooses delete and confirms
- **THEN** the UI sends `DELETE /api/configurations/c1` with `Content-Type: application/json`
- **AND** the list no longer shows `Ops`

#### Scenario: Delete without confirmation does not call the API

- **GIVEN** a configuration is listed
- **WHEN** the operator chooses delete and dismisses the confirmation without confirming
- **THEN** no `DELETE` request is sent

### Requirement: Enable or disable from the Configurations screen

The Configurations screen SHALL update `enabled` with `PATCH /api/configurations/:id` and JSON body `{ "enabled": <boolean> }` and header `Content-Type: application/json`. On success the list SHALL reflect the new `enabled` value. The PATCH response and the list SHALL NOT show a token.

#### Scenario: Disable a configuration

- **GIVEN** a configuration `c1` is listed as enabled and `PATCH /api/configurations/c1` will return `{ "id": "c1", "name": "Ops", "enabled": false }`
- **WHEN** the operator disables that configuration
- **THEN** the UI sends `PATCH /api/configurations/c1` with `Content-Type: application/json` and body including `"enabled":false`
- **AND** the list shows the configuration as disabled
- **AND** no bearer token is shown as a result of the disable action

### Requirement: Show English errors from failed API calls

When a Configurations API call fails with a non-success HTTP status, the Configurations screen SHALL show a short English error message to the operator and SHALL NOT display a bearer token or token hash from any response body.

#### Scenario: List error is shown in English

- **GIVEN** `GET /api/configurations` returns status 500 with an English error body
- **WHEN** the Configurations screen loads
- **THEN** an English error message is visible to the operator
- **AND** no bearer token is shown

### Requirement: Connectors list from API

The Connectors screen SHALL load connectors with `GET /api/connectors` and accounts with `GET /api/accounts`. When the connectors response is an empty array, the UI SHALL show the English empty-state copy exactly: `No connectors yet.` When the connectors response is a non-empty array, the UI SHALL list each connector's `name` and, under that connector, the accounts whose `connector` id matches that connector. The list view SHALL NOT render allowed destinations, connection-check details, or secret field values. Secret field keys SHALL NOT be rendered on account rows.

#### Scenario: Empty API list keeps the empty-state copy

- **GIVEN** `GET /api/connectors` returns an empty array
- **AND** `GET /api/accounts` returns an empty array
- **WHEN** the operator opens the Connectors screen
- **THEN** the UI sends `GET /api/connectors`
- **AND** the UI sends `GET /api/accounts`
- **AND** the document shows the text `No connectors yet.`
- **AND** the document does not show the text `Connector accounts will appear here in a later change.`

#### Scenario: Non-empty list shows name and fields without account actions

- **GIVEN** `GET /api/connectors` returns `[{ "id": "fake", "name": "Fake", "kind": "native", "fields": [{ "name": "token", "label": "Token", "type": "secret", "required": true }, { "name": "user", "label": "User", "type": "text", "required": true }] }]`
- **AND** `GET /api/accounts` returns `[{ "id": "a1", "connector": "fake", "label": "Box", "enabled": true, "values": { "user": "alice" } }]`
- **WHEN** the operator opens the Connectors screen
- **THEN** the list shows the connector name `Fake`
- **AND** under that connector the list shows account label `Box`, that the account is enabled, and non-secret value `alice`
- **AND** the document does not contain a secret field key named `token` as a rendered account value key
- **AND** the document does not show account secret values

### Requirement: Show English errors from failed connectors list

When `GET /api/connectors` fails with a non-success HTTP status, the Connectors screen SHALL show a short English error message to the operator and SHALL NOT display secrets or account values.

#### Scenario: Connectors list error is shown in English

- **GIVEN** `GET /api/connectors` returns status 500 with an English error body
- **WHEN** the operator opens the Connectors screen
- **THEN** an English error message is visible to the operator
- **AND** no account secret value is shown

### Requirement: Account form from connector field descriptions

The Connectors screen SHALL present one account dialog form built from the selected connector's `fields` of types `text`, `secret`, and `host`, plus a required account `label` input that is not a connector field. Create SHALL send `POST /api/accounts` with `Content-Type: application/json` and body `{ connector, label, values }` using the full submitted values. Edit SHALL send `PATCH /api/accounts/:id` with `Content-Type: application/json`; when the operator leaves a secret field blank, the UI SHALL omit that key from `values` so the store keeps the existing secret. After a successful create or edit, the UI SHALL clear secret input state so the fixture secret string is absent from the document. On connection-check failure the UI SHALL show the API error response text and SHALL NOT show a connector exception message.

#### Scenario: Create sends full values and clears secret input after success

- **GIVEN** the Connectors screen lists connector `fake` with required fields `user` (text) and `token` (secret)
- **AND** `POST /api/accounts` will return status 201 with a public account object whose `values` omit `token`
- **WHEN** the operator adds an account with label `Box`, user `alice`, and secret `fixture-secret-value`
- **THEN** the UI sends `POST /api/accounts` with `Content-Type: application/json` and body including `"connector":"fake"`, `"label":"Box"`, and `"values"` containing `"user":"alice"` and `"token":"fixture-secret-value"`
- **AND** after success the document does not contain `fixture-secret-value`

#### Scenario: Edit omits blank secret keys

- **GIVEN** an account `a1` for connector `fake` is listed
- **AND** `PATCH /api/accounts/a1` will return status 200 with `values` that omit secret keys
- **WHEN** the operator edits that account, leaves the secret field blank, and submits
- **THEN** the UI sends `PATCH /api/accounts/a1` with `Content-Type: application/json`
- **AND** the request JSON `values` object has no `token` property
- **AND** after success no secret field value from the form remains in the document

#### Scenario: Create connection-check failure shows API error text

- **GIVEN** the Connectors screen lists connector `fake`
- **AND** `POST /api/accounts` will return status 400 with body exactly `Connection check failed`
- **WHEN** the operator submits a new account with valid-looking field shapes
- **THEN** the UI shows the text `Connection check failed`
- **AND** the document does not show a connector exception stack or a fixture secret string from a connector error

### Requirement: Check connection, disable, and delete account

On a saved account the Connectors screen SHALL offer check connection, disable, and delete. Check connection SHALL call `POST /api/accounts/:id/check` with `Content-Type: application/json` and SHALL NOT write through other account mutations for that action. Disable SHALL be a checkbox that sends `PATCH /api/accounts/:id` with body `{ "enabled": <boolean> }` only and `Content-Type: application/json`. Delete SHALL require an explicit confirmation step, then call `DELETE /api/accounts/:id` with `Content-Type: application/json`, and on success remove the account from the Connectors list. After a successful delete, that account id SHALL no longer appear as a checked option on the Configurations screen account checkboxes once configurations are refreshed from the API.

#### Scenario: Check connection calls the check route

- **GIVEN** an account `a1` is listed on the Connectors screen
- **AND** `POST /api/accounts/a1/check` will return status 200
- **WHEN** the operator chooses check connection for that account
- **THEN** the UI sends `POST /api/accounts/a1/check` with `Content-Type: application/json`
- **AND** no `PATCH` or `DELETE` for that account is sent for that action

#### Scenario: Disable sends enabled-only PATCH

- **GIVEN** an account `a1` is listed as enabled
- **AND** `PATCH /api/accounts/a1` will return `{ "id": "a1", "connector": "fake", "label": "Box", "enabled": false, "values": { "user": "alice" } }`
- **WHEN** the operator disables that account
- **THEN** the UI sends `PATCH /api/accounts/a1` with `Content-Type: application/json` and body exactly including `"enabled":false` without other top-level fields besides `enabled`
- **AND** the list shows the account as disabled

#### Scenario: Delete requires confirmation then removes the row

- **GIVEN** an account `a1` labeled `Box` is listed and `DELETE /api/accounts/a1` will return status 204
- **WHEN** the operator chooses delete and confirms
- **THEN** the UI sends `DELETE /api/accounts/a1` with `Content-Type: application/json`
- **AND** the Connectors list no longer shows `Box`

#### Scenario: Delete without confirmation does not call the API

- **GIVEN** an account is listed
- **WHEN** the operator chooses delete and dismisses the confirmation without confirming
- **THEN** no `DELETE` request is sent

### Requirement: Configuration account checkboxes by connector

On the Configurations screen the UI SHALL load configurations with `GET /api/configurations` (including each configuration's `accountIds`) and load accounts and connectors as needed to render account checkboxes grouped by connector under each configuration. Toggling a checkbox SHALL immediately send `PUT /api/configurations/:id/accounts` with `Content-Type: application/json` and body `{ "accountIds": <full replacement list> }` for that configuration. Disabled accounts SHALL appear in the checkbox list and MAY be assigned. The list and checkbox UI SHALL NOT show a bearer `token` or `tokenHash`. Bearer plaintext SHALL remain only in the existing create/rotate reveal dialog.

#### Scenario: Toggle assigns the full accountIds list

- **GIVEN** configuration `c1` is listed with `accountIds` `[]`
- **AND** accounts include `a1` (connector `fake`, label `Box`, enabled true) and connectors include `fake` named `Fake`
- **AND** `PUT /api/configurations/c1/accounts` will return status 200 with `accountIds` `["a1"]`
- **WHEN** the operator checks the account `Box` under connector `Fake` for configuration `c1`
- **THEN** the UI sends `PUT /api/configurations/c1/accounts` with `Content-Type: application/json` and body `{ "accountIds": ["a1"] }`
- **AND** no bearer token is shown as a result of that toggle

#### Scenario: Disabled account may be assigned from the UI

- **GIVEN** configuration `c1` is listed with `accountIds` `[]`
- **AND** account `a1` is listed as disabled with label `Box` under connector `Fake`
- **AND** `PUT /api/configurations/c1/accounts` will return status 200 with `accountIds` `["a1"]`
- **WHEN** the operator checks the disabled account `Box` for configuration `c1`
- **THEN** the UI sends `PUT /api/configurations/c1/accounts` with body `{ "accountIds": ["a1"] }`
- **AND** the checkbox for `Box` appears checked

#### Scenario: Uncheck removes the id from the full list

- **GIVEN** configuration `c1` is listed with `accountIds` `["a1", "a2"]`
- **AND** `PUT /api/configurations/c1/accounts` will return status 200 with `accountIds` `["a2"]`
- **WHEN** the operator unchecks account `a1` for configuration `c1`
- **THEN** the UI sends `PUT /api/configurations/c1/accounts` with body `{ "accountIds": ["a2"] }`

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
