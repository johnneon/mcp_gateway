# Spec Delta

## REMOVED Requirements

### Requirement: Connectors empty state

**Reason**: The Connectors screen now loads `GET /api/connectors` instead of rendering a static empty state with no HTTP calls.

**Migration**: Use the new requirement `Connectors list from API` in this delta. Empty responses keep the same empty-state copy; non-empty responses list connector names and fields.

## ADDED Requirements

### Requirement: Connectors list from API

The Connectors screen SHALL load connectors with `GET /api/connectors`. When the response is an empty array, the UI SHALL show the English empty-state copy exactly: `No connectors yet. Connector accounts will appear here in a later change.` When the response is a non-empty array, the UI SHALL list each connector's `name` and its `fields` (each field's `label`, `type`, and `required`). The Connectors screen SHALL NOT present account actions (add, edit, check connection, disable, or delete). The list view SHALL NOT render allowed destinations, connection-check details, secrets, or account values.

#### Scenario: Empty API list keeps the empty-state copy

- **GIVEN** `GET /api/connectors` returns an empty array
- **WHEN** the operator opens the Connectors screen
- **THEN** the UI sends `GET /api/connectors`
- **AND** the document shows the text `No connectors yet. Connector accounts will appear here in a later change.`
- **AND** no account action controls (add, edit, check, disable, delete) are shown

#### Scenario: Non-empty list shows name and fields without account actions

- **GIVEN** `GET /api/connectors` returns `[{ "id": "fake", "name": "Fake", "kind": "native", "fields": [{ "name": "token", "label": "Token", "type": "secret", "required": true }] }]`
- **WHEN** the operator opens the Connectors screen
- **THEN** the list shows the connector name `Fake`
- **AND** the list shows field label `Token`, type `secret`, and that the field is required
- **AND** no account action controls (add, edit, check, disable, delete) are shown
- **AND** the document does not show account secret values

### Requirement: Show English errors from failed connectors list

When `GET /api/connectors` fails with a non-success HTTP status, the Connectors screen SHALL show a short English error message to the operator and SHALL NOT display secrets or account values.

#### Scenario: Connectors list error is shown in English

- **GIVEN** `GET /api/connectors` returns status 500 with an English error body
- **WHEN** the operator opens the Connectors screen
- **THEN** an English error message is visible to the operator
- **AND** no account secret value is shown
