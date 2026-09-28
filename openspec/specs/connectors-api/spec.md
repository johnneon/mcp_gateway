# connectors-api Specification

## Purpose

Defines the admin-port HTTP API that lists the public description of connectors from the in-code registry without exposing allowed destinations, connection checks, secrets, or account values.

## Requirements

### Requirement: List connectors public description

`GET /api/connectors` on the admin port SHALL return status 200 and a JSON array of objects `{ id, name, kind, fields }` where each `fields` element is `{ name, label, type, required }`. Each object SHALL NOT include allowed destinations, a connection-check function or property, secrets, or account values. When the registry is empty, the body SHALL be an empty JSON array. The route SHALL use the same JSON and short-English error style as the configurations admin API.

#### Scenario: Empty registry lists as empty array

- **GIVEN** the admin app is created with an empty connector registry
- **WHEN** the client performs `GET /api/connectors` on the admin app
- **THEN** the response status is 200
- **AND** the body parsed as JSON is an empty array

#### Scenario: Fake connector is listed without internals

- **GIVEN** the admin app is created with a registry containing one fake native connector with `id` `fake`, `name` `Fake`, `kind` `native`, fields including a `secret` field, and at least one allowed destination
- **WHEN** the client performs `GET /api/connectors`
- **THEN** the response status is 200
- **AND** the JSON array has one element with `id` `fake`, `name` `Fake`, `kind` `native`, and a `fields` array of `{ name, label, type, required }` objects matching that connector
- **AND** the serialized response body does not include allowed-destination hosts or ports
- **AND** the serialized response body does not include account secret values

### Requirement: GET connectors needs no JSON Content-Type

`GET /api/connectors` SHALL succeed without a `Content-Type` header. The existing admin `/api` rule that requires `application/json` for non-GET methods SHALL remain unchanged by this change.

#### Scenario: GET without Content-Type returns 200

- **GIVEN** the admin app with an empty connector registry
- **WHEN** the client performs `GET /api/connectors` without a `Content-Type` header
- **THEN** the response status is 200
- **AND** the body parsed as JSON is an empty array

### Requirement: No CORS headers on connectors API responses

No response for `GET /api/connectors` on the admin port SHALL include a CORS header (`Access-Control-Allow-Origin`, `Access-Control-Allow-Methods`, `Access-Control-Allow-Headers`, or `Access-Control-Allow-Credentials`).

#### Scenario: Successful connectors list has no CORS headers

- **GIVEN** the admin app with an empty connector registry
- **WHEN** the client performs `GET /api/connectors`
- **THEN** the response has none of the headers `Access-Control-Allow-Origin`, `Access-Control-Allow-Methods`, `Access-Control-Allow-Headers`, or `Access-Control-Allow-Credentials`
