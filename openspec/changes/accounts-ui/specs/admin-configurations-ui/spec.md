# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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
