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

### Requirement: Connectors empty state

The Connectors screen SHALL show an English empty state. That screen SHALL NOT load accounts and SHALL NOT send any HTTP API requests when opened.

#### Scenario: Connectors shows empty state without API calls

- **GIVEN** the admin UI is rendered
- **WHEN** the operator opens the Connectors screen
- **THEN** an English empty state is visible
- **AND** no HTTP requests are sent as a result of opening that screen
