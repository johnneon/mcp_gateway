# mcp-endpoint Specification

## Purpose

Defines bearer-authenticated MCP Streamable HTTP on the MCP port: identical refusals for failed auth, and an empty tools/list when no connectors are registered yet.

## Requirements

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

### Requirement: Resolve first enabled configuration after bearer auth

After a successful bearer authentication on `POST /mcp`, the process SHALL determine the active configuration by scanning every stored configuration in document order and selecting the first row whose token hash matches the presented bearer and whose `enabled` is true. All subsequent `tools/list` and `tools/call` handling for that request SHALL use that active configuration. Existing identical Unauthorized refusals for failed auth SHALL remain unchanged.

#### Scenario: First enabled matching configuration scopes tools

- **GIVEN** the MCP app is created with a fake native connector registry and a store that has two enabled configurations that do not share a bearer, the first configuration's `accountIds` including an enabled fake-connector account and the second configuration's `accountIds` empty
- **AND** the plaintext bearer of the first configuration is known to the test
- **WHEN** an MCP client authenticates with that first bearer and calls `tools/list`
- **THEN** the listed tools include the fake connector's tool
- **WHEN** an MCP client authenticates with the second configuration's bearer and calls `tools/list`
- **THEN** the listed tools array is empty

### Requirement: tools/list from eligible accounts only

After authentication, `tools/list` SHALL be built per request from the active configuration and the injected connector registry. A connector's tools SHALL appear in the list only when the active configuration has at least one eligible account of that connector. An account is eligible when its id is listed in the configuration's `accountIds`, the account exists in the store, `enabled` is true, and its `connector` equals that connector's id. When no connector has any eligible account, or the registry has no connectors, `tools/list` SHALL return an empty tool array. Existing empty `tools/list` behavior for an empty production registry SHALL stay intact.

#### Scenario: Connector tools hidden when configuration has no eligible account

- **GIVEN** the MCP app with a fake native connector that declares a tool and a store with one enabled account of that connector and two enabled configurations — configuration A includes that account id in `accountIds`, configuration B does not
- **WHEN** an MCP client authenticates with configuration B's bearer and calls `tools/list`
- **THEN** the listed tools array is empty

#### Scenario: Connector tools listed when configuration has an eligible account

- **GIVEN** the same store and registry as the previous scenario
- **WHEN** an MCP client authenticates with configuration A's bearer and calls `tools/list`
- **THEN** the listed tools include the fake tool under MCP name `<connector id>_<tool name>`

#### Scenario: Empty production registry still yields empty tools/list

- **GIVEN** the MCP app is created with the production empty connector registry and a store that has one enabled configuration whose plaintext bearer is known to the test
- **WHEN** an MCP client using Streamable HTTP connects with that bearer, completes initialize, and calls `tools/list`
- **THEN** initialize succeeds
- **AND** `tools/list` returns an empty tool array

### Requirement: Injected account argument in tool schemas

For every tool exposed in `tools/list`, the process SHALL add a required `account` property to the tool's input JSON Schema. The property SHALL have type `string` and an `enum` containing only the ids of eligible accounts for that tool's connector. The property `description` SHALL list those accounts for clients, one entry per account, each formatted as `<id> (<label>)`. The schema SHALL NOT use `oneOf`, `const`, or `title` to carry account labels. Account field values, including secrets, SHALL NOT appear in the tool schema.

#### Scenario: Account enum and description show only eligible accounts

- **GIVEN** the MCP app with a fake connector tool and an enabled configuration whose eligible accounts are one account with a known id and label
- **WHEN** an MCP client authenticates with that configuration's bearer and calls `tools/list`
- **THEN** the tool's input schema requires property `account`
- **AND** `account.enum` equals an array containing only that account id
- **AND** `account.description` contains the substring `<id> (<label>)` for that account
- **AND** the serialized tool schema does not contain any stored secret field value of that account

### Requirement: tools/call validates, authorizes, then invokes handler

On `tools/call`, the process SHALL locate the tool by its MCP name. The process SHALL validate the call arguments against the tool's JSON Schema including the injected `account` property, using JSON Schema validation. On validation failure the process SHALL return a short English MCP error and SHALL NOT invoke the connector handler. After successful validation, the process SHALL verify that the `account` argument identifies an eligible account for the tool's connector under the active configuration (id in `accountIds`, account enabled, connector matches). If that check fails, the process SHALL return a short English MCP error and SHALL NOT invoke the handler. On success the process SHALL build an egress client for that account from the connector's allowed destinations and SHALL invoke the handler with the model arguments with `account` removed, the decrypted account field values, and that egress client. When the handler fails because of an egress network error whose message is one of `Destination is not allowed`, `Redirect is not allowed`, `Connection failed`, or `Response too large`, the process SHALL return that same short English phrase as the MCP error and SHALL NOT replace it with `Tool execution failed`. If the handler throws any other error, the process SHALL return a fixed English MCP error that does not include the exception text and SHALL NOT include account secret values.

#### Scenario: Successful call increments fake counter and passes decrypted values

- **GIVEN** the MCP app with a fake native connector whose tool handler increments a call counter and records the account field values it received, and a store with an enabled account that has a fixture secret field value known to the test, included in an enabled configuration
- **WHEN** an MCP client authenticates with that configuration's bearer and calls the fake tool with valid arguments and `account` set to that account id
- **THEN** the call succeeds
- **AND** the fake call counter equals 1
- **AND** the handler-recorded field values include the fixture secret string
- **AND** the MCP result does not need to echo the secret for the assertion to pass

#### Scenario: Account absent from configuration refuses without calling handler

- **GIVEN** the MCP app with a fake connector whose call counter starts at 0, an enabled account of that connector, and an enabled configuration whose `accountIds` do not include that account
- **WHEN** an MCP client authenticates with that configuration's bearer and calls the fake tool with `account` set to that account id
- **THEN** the response is an MCP error with short English text
- **AND** the fake call counter equals 0

#### Scenario: Foreign account refuses without calling handler

- **GIVEN** the MCP app with a fake connector whose call counter starts at 0, two enabled accounts of that connector, and an enabled configuration whose `accountIds` include only the first account
- **WHEN** an MCP client authenticates with that configuration's bearer and calls the fake tool with `account` set to the second account id
- **THEN** the response is an MCP error with short English text
- **AND** the fake call counter equals 0

#### Scenario: Disabled account refuses without calling handler

- **GIVEN** the MCP app with a fake connector whose call counter starts at 0, a disabled account of that connector whose id is listed in an enabled configuration's `accountIds`
- **WHEN** an MCP client authenticates with that configuration's bearer and calls the fake tool with `account` set to that account id
- **THEN** the response is an MCP error with short English text
- **AND** the fake call counter equals 0

#### Scenario: Schema validation failure refuses without calling handler

- **GIVEN** the MCP app with a fake connector whose tool arguments schema requires a string property and whose call counter starts at 0, and an enabled configuration with an eligible account
- **WHEN** an MCP client authenticates with that configuration's bearer and calls the fake tool with `account` set to the eligible id but with arguments that fail the tool schema
- **THEN** the response is an MCP error with short English text
- **AND** the fake call counter equals 0

#### Scenario: Handler throw becomes fixed English error without exception text

- **GIVEN** the MCP app with a fake connector whose handler throws an Error whose message contains a fixture secret string, and an enabled configuration with an eligible account
- **WHEN** an MCP client authenticates with that configuration's bearer and calls the fake tool with valid arguments and that account id
- **THEN** the response is an MCP error whose message is a fixed English string
- **AND** the error text does not contain the fixture secret string
- **AND** the error text does not contain the handler exception message beyond that fixed string

#### Scenario: Successful call passes egress client to handler

- **GIVEN** the MCP app with a fake native connector whose tool handler records the egress client argument it received, and an enabled configuration with an eligible account
- **WHEN** an MCP client authenticates with that configuration's bearer and calls the fake tool with valid arguments and that account id
- **THEN** the call succeeds
- **AND** the handler-recorded egress client is present

#### Scenario: Egress Destination is not allowed reaches the MCP client unchanged

- **GIVEN** the MCP app with a fake native connector whose handler uses the egress client against a disallowed host so the client refuses with `Destination is not allowed`, and an enabled configuration with an eligible account
- **WHEN** an MCP client authenticates with that configuration's bearer and calls the fake tool
- **THEN** the response is an MCP error whose message is exactly `Destination is not allowed`
- **AND** the error text is not `Tool execution failed`

### Requirement: Scrub secret account values from tool results and errors

Before the MCP client sees a successful tool result, the process SHALL replace every non-empty account field value of type `secret` for the selected account with the literal `[redacted]` in each text content part. Longer secret values SHALL be replaced before shorter ones. Empty secret values SHALL be left unchanged. Account field values that are not type `secret` (including `text`, `host`, and email-address-like text fields) SHALL NOT be redacted by this rule. Before an MCP error message reaches the client, the process SHALL scrub those same non-empty secret values from the error text. Fixed egress phrases that already exclude response bodies remain as specified; scrubbing is defense in depth if a message would otherwise contain a secret.

#### Scenario: Secret returned in the body is redacted in the tool result

- **GIVEN** the MCP app with a fake native connector whose handler returns a text content part that includes a non-empty fixture secret field value from the selected account, and an enabled configuration with that eligible account
- **WHEN** an MCP client authenticates with that configuration's bearer and calls the fake tool successfully
- **THEN** the MCP tool result text contains `[redacted]`
- **AND** the MCP tool result text does not contain the fixture secret string

#### Scenario: Longer secret is redacted before a shorter overlapping secret

- **GIVEN** the MCP app with a fake account that has two non-empty secret fields whose values are `ab` and `abc`, and a fake handler that returns text containing `abc`
- **WHEN** an MCP client calls that tool successfully
- **THEN** the result text does not contain the substring `abc` as the secret value
- **AND** the result text contains `[redacted]`

#### Scenario: Empty secret and non-secret fields are not redacted

- **GIVEN** the MCP app with a fake account that has an empty secret field, a non-empty `text` field value `visible-text`, and a non-empty `host` field value `mail.example.test`, and a fake handler that returns text containing `visible-text` and `mail.example.test`
- **WHEN** an MCP client calls that tool successfully
- **THEN** the result text still contains `visible-text` and `mail.example.test`
- **AND** empty secret values are not replaced with `[redacted]`

#### Scenario: Secret in error text is scrubbed before the client sees it

- **GIVEN** the MCP app with a fake connector whose handler throws or fails with a message that embeds a non-empty fixture secret field value from the selected account
- **WHEN** an MCP client calls that tool
- **THEN** the MCP error text does not contain the fixture secret string
