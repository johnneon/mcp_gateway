# Spec Delta

## MODIFIED Requirements

### Requirement: List connectors public description

`GET /api/connectors` on the admin port SHALL return status 200 and a JSON array of objects `{ id, name, kind, fields, tools }` where each `fields` element is `{ name, label, type, required }` and each `tools` element is `{ name, description }`. Each tool `name` SHALL be that connector's MCP tool name, the connector id, an underscore, and the tool's short name. Each object SHALL NOT include input schemas, handlers, allowed destinations, a connection-check function or property, secrets, or account values. When the registry is empty, the body SHALL be an empty JSON array. The route SHALL use the same JSON and short-English error style as the configurations admin API.

#### Scenario: Empty registry lists as empty array

- **GIVEN** the admin app is created with an empty connector registry
- **WHEN** the client performs `GET /api/connectors` on the admin app
- **THEN** the response status is 200
- **AND** the body parsed as JSON is an empty array

#### Scenario: Fake connector is listed without internals

- **GIVEN** the admin app is created with a registry containing one fake native connector with `id` `fake`, `name` `Fake`, `kind` `native`, fields including a `secret` field, one tool whose short name is `drop` and whose description is `Drop a row`, and at least one allowed destination
- **WHEN** the client performs `GET /api/connectors`
- **THEN** the response status is 200
- **AND** the JSON array has one element with `id` `fake`, `name` `Fake`, `kind` `native`, and a `fields` array of `{ name, label, type, required }` objects matching that connector
- **AND** that element's `tools` array is `[{ "name": "fake_drop", "description": "Drop a row" }]`
- **AND** the serialized response body does not include an input schema, a handler, allowed-destination hosts or ports, or account secret values
