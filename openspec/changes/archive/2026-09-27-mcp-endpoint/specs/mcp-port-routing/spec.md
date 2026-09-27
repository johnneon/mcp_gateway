# Spec Delta

## ADDED Requirements

### Requirement: /mcp on the MCP port serves Streamable HTTP after auth

The MCP listener SHALL register the path `/mcp`. `POST /mcp` SHALL authenticate the bearer as specified by the `mcp-endpoint` capability and, on success, SHALL handle the request as MCP Streamable HTTP. `GET /mcp`, `DELETE /mcp`, and any other HTTP method on `/mcp` other than `POST` SHALL return status 405 with a short English text body and no secrets, and SHALL NOT open an SSE stream. This change SHALL NOT return status 501 for `/mcp`.

#### Scenario: GET /mcp — 405 without secrets and without SSE

- **GIVEN** the MCP app is created through the factory without `listen`
- **WHEN** the client performs `GET /mcp`
- **THEN** the response status is 405
- **AND** the response body is short English text
- **AND** the body does not contain the data directory, the encryption key, or hosts and ports from the test environment
- **AND** the response is not an open SSE stream (no `text/event-stream` content type for a lasting stream)

#### Scenario: DELETE /mcp — 405 without secrets

- **GIVEN** the MCP app is created through the factory without `listen`
- **WHEN** the client performs `DELETE /mcp`
- **THEN** the response status is 405
- **AND** the response body is short English text with no secrets

#### Scenario: POST /mcp without Authorization — 401 not 501

- **GIVEN** the MCP app is created with a store (empty configurations list is enough)
- **WHEN** the client performs `POST /mcp` without an `Authorization` header
- **THEN** the response status is 401
- **AND** the body is exactly `Unauthorized`
- **AND** the response status is not 501

## REMOVED Requirements

### Requirement: /mcp on the MCP port returns 501

**Reason**: Replaced by Streamable HTTP after bearer auth and 405 for non-POST methods on `/mcp`.
**Migration**: Follow the added requirement "/mcp on the MCP port serves Streamable HTTP after auth" and the `mcp-endpoint` capability.
