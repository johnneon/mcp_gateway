# Spec Delta

## Purpose

Defines bearer-authenticated MCP Streamable HTTP on the MCP port: identical refusals for failed auth, and an empty tools/list when no connectors are registered yet.

## ADDED Requirements

### Requirement: Bearer authentication before JSON-RPC on POST /mcp

On every `POST /mcp` on the MCP port, the process SHALL authenticate before any JSON-RPC handling. The `Authorization` header SHALL use scheme `Bearer` case-insensitively, exactly one space after the scheme, and the token SHALL be the exact remainder of the header value with no trim. The process SHALL compare that token with `tokenMatchesHash` against every stored configuration's `tokenHash` and SHALL NOT return before the full scan completes. The request SHALL be accepted only when at least one matching configuration has `enabled` equal to `true`. A disabled match alone SHALL be treated the same as no match.

#### Scenario: Enabled configuration bearer is accepted

- **GIVEN** the MCP app is created with a store that has one enabled configuration whose plaintext bearer is known to the test
- **WHEN** the client performs `POST /mcp` with `Authorization: Bearer <that token>` and a valid MCP initialize body
- **THEN** the response is not status 401
- **AND** the body is not exactly `Unauthorized`

#### Scenario: Disabled configuration bearer is refused like unknown

- **GIVEN** the MCP app is created with a store that has one disabled configuration whose plaintext bearer is known to the test
- **WHEN** the client performs `POST /mcp` with `Authorization: Bearer <that token>`
- **THEN** the response status is 401
- **AND** `Content-Type` contains `text/plain`
- **AND** the body is exactly `Unauthorized`

### Requirement: Identical Unauthorized refusal for failed auth

When authentication fails for any of: missing `Authorization` header, empty bearer token (header is `Bearer` with an empty remainder after the single space), unknown token, or only disabled matching configurations, the process SHALL respond with status 401, `Content-Type` of `text/plain` (charset optional), and body bytes exactly `Unauthorized`, before any JSON-RPC handling. The status and body SHALL be identical across those cases. The response SHALL NOT include any configuration name, id, or other store field that would distinguish the cases.

#### Scenario: Missing Authorization — 401 Unauthorized

- **GIVEN** the MCP app is created with a store that has at least one enabled configuration
- **WHEN** the client performs `POST /mcp` without an `Authorization` header
- **THEN** the response status is 401
- **AND** `Content-Type` contains `text/plain`
- **AND** the body is exactly `Unauthorized`
- **AND** the body does not contain any configuration name from the store

#### Scenario: Empty bearer — same 401 as missing

- **GIVEN** the MCP app is created with a store that has at least one enabled configuration
- **WHEN** the client performs `POST /mcp` with header `Authorization: Bearer ` (scheme, one space, empty token)
- **THEN** the response status is 401
- **AND** the body is exactly `Unauthorized`

#### Scenario: Unknown token — same 401 as missing

- **GIVEN** the MCP app is created with a store that has at least one enabled configuration
- **WHEN** the client performs `POST /mcp` with `Authorization: Bearer` and a token that matches no configuration hash
- **THEN** the response status is 401
- **AND** the body is exactly `Unauthorized`

#### Scenario: Four refusal cases are byte-identical

- **GIVEN** the MCP app is created with a store that has one enabled configuration and one disabled configuration (disabled bearer known to the test)
- **WHEN** the client performs four `POST /mcp` requests: no `Authorization`; `Authorization: Bearer ` with empty token; an unknown bearer; the disabled configuration's bearer
- **THEN** all four responses have status 401
- **AND** all four response bodies are exactly `Unauthorized`
- **AND** no response body contains a configuration name

### Requirement: Stateless Streamable HTTP with empty tools/list

After successful authentication, `POST /mcp` on the MCP port SHALL be handled with MCP Streamable HTTP in stateless mode: one new transport per request, no session id, JSON responses enabled, and no `tools/list_changed` notifications. The MCP server identity SHALL be name `mcp-gateway` and version `0.0.0`. With no tools registered, `tools/list` SHALL return an empty list. There SHALL NOT be a separate SSE endpoint for MCP. Token validity SHALL be re-checked by reading the store on every request.

#### Scenario: Initialize and empty tools/list with enabled bearer

- **GIVEN** the MCP app listens on `127.0.0.1` on an ephemeral port with a store that has one enabled configuration whose plaintext bearer is known to the test
- **WHEN** an MCP client using Streamable HTTP connects with that bearer, completes initialize, and calls `tools/list`
- **THEN** initialize succeeds
- **AND** `tools/list` returns an empty tool array

#### Scenario: No session id on successful POST

- **GIVEN** the MCP app is created with a store that has one enabled configuration whose plaintext bearer is known to the test
- **WHEN** the client performs an authenticated `POST /mcp` that completes a successful MCP initialize exchange
- **THEN** the response does not require the client to present a session id on a subsequent request for the exchange to be valid in this change's contract
- **AND** the server does not rely on a persistent session for that request
