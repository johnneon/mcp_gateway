# Spec Delta

## Purpose

Defines HTTP routing for the MCP and admin ports: the allowed paths, responses that contain no secrets, and rejection of foreign requests, until Streamable HTTP is mounted.

## ADDED Requirements

### Requirement: GET /health on the MCP port without authentication

The MCP listener SHALL answer `GET /health` without requiring an `Authorization` header. The response SHALL have status 200, a `Content-Type` header of `application/json`, and a body that is exactly the JSON object `{ "status": "ok" }`. The body SHALL NOT contain the data directory path, the encryption key value, or host or port names or values. An `Authorization` header SHALL NOT change the status, the content type, or the body. A query string on `GET /health` SHALL NOT change the route: the response stays the same successful health.

#### Scenario: GET /health without Authorization

- **GIVEN** the MCP app is created through the factory without `listen`
- **WHEN** the client performs `GET /health` without an `Authorization` header
- **THEN** the response status is 200
- **AND** `Content-Type` contains `application/json`
- **AND** the body parsed as JSON deep-equals `{ "status": "ok" }`
- **AND** the serialized body does not contain substrings of the data directory, the encryption key, or hosts and ports from the test environment

#### Scenario: GET /health with Authorization does not change the response

- **GIVEN** the MCP app is created through the factory without `listen`
- **WHEN** the client performs `GET /health` with an `Authorization` header (an arbitrary bearer value known to the test)
- **THEN** the response status is 200
- **AND** the body parsed as JSON deep-equals `{ "status": "ok" }`
- **AND** the response does not contain the bearer value that was sent

#### Scenario: GET /health with a query string

- **GIVEN** the MCP app is created through the factory without `listen`
- **WHEN** the client performs `GET /health?x=1`
- **THEN** the response status is 200
- **AND** the body parsed as JSON deep-equals `{ "status": "ok" }`

### Requirement: /mcp on the MCP port returns 501

The MCP listener SHALL register the path `/mcp` for every HTTP method the handler reaches. The response SHALL have status 501 and a short English text body with no secrets, no data directory, no encryption key, and no host or port values. This change SHALL NOT run Streamable HTTP or check a bearer.

#### Scenario: GET /mcp — 501 without secrets

- **GIVEN** the MCP app is created through the factory without `listen`
- **WHEN** the client performs `GET /mcp`
- **THEN** the response status is 501
- **AND** the response body is short English text
- **AND** the body does not contain the data directory, the encryption key, or hosts and ports from the test environment

#### Scenario: POST /mcp — 501 without secrets

- **GIVEN** the MCP app is created through the factory without `listen`
- **WHEN** the client performs `POST /mcp` with an arbitrary body
- **THEN** the response status is 501
- **AND** the response body is short English text with no secrets

### Requirement: A foreign path on the MCP port is 404

Any path on the MCP listener other than the registered `GET /health` and `/mcp` SHALL return status 404 with a short English text body and no secrets. `POST`, `PUT`, and `DELETE` to `/health` SHALL count as foreign and return 404. The path `/health/` (with a trailing slash) SHALL count as foreign and return 404.

#### Scenario: Unknown path — 404

- **GIVEN** the MCP app is created through the factory without `listen`
- **WHEN** the client performs `GET /unknown`
- **THEN** the response status is 404
- **AND** the response body is short English text with no secrets

#### Scenario: POST /health — 404

- **GIVEN** the MCP app is created through the factory without `listen`
- **WHEN** the client performs `POST /health`
- **THEN** the response status is 404

#### Scenario: PUT /health — 404

- **GIVEN** the MCP app is created through the factory without `listen`
- **WHEN** the client performs `PUT /health`
- **THEN** the response status is 404

#### Scenario: DELETE /health — 404

- **GIVEN** the MCP app is created through the factory without `listen`
- **WHEN** the client performs `DELETE /health`
- **THEN** the response status is 404

#### Scenario: GET /health/ — 404

- **GIVEN** the MCP app is created through the factory without `listen`
- **WHEN** the client performs `GET /health/`
- **THEN** the response status is 404

### Requirement: The admin port does not serve /mcp

The admin listener SHALL have an explicit handler for the path `/mcp`, for every method, registered before the `web` static files. That handler SHALL return status 404 with a short English text body and no secrets. Even if the static root contains a file that could be served at `/mcp`, the response SHALL stay 404. `GET /` on admin SHALL still return a successful response with the application shell HTML.

#### Scenario: GET /mcp on admin — 404 before static files

- **GIVEN** the admin app is created through the factory with a test static root that contains a file which could be served at `/mcp` (for example `mcp` or `mcp.html`, whichever `express.static` would serve in the test)
- **WHEN** the client performs `GET /mcp`
- **THEN** the response status is 404
- **AND** the response body is short English text
- **AND** the body does not match the static file's contents

#### Scenario: POST /mcp on admin — 404

- **GIVEN** the admin app is created through the factory without `listen`
- **WHEN** the client performs `POST /mcp`
- **THEN** the response status is 404

#### Scenario: GET / on admin still returns HTML

- **GIVEN** the admin app is created through the factory with a static root that contains the shell `index.html`
- **WHEN** the client performs `GET /`
- **THEN** the response status is successful
- **AND** the body contains the admin UI shell HTML
