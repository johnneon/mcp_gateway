# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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
