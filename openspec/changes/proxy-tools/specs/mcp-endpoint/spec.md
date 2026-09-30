# Spec Delta

## ADDED Requirements

### Requirement: Proxy tools/list from the in-code allowlist

After authentication, `tools/list` SHALL include a proxy connector's allowlisted tools only when the active configuration has at least one eligible account of that connector, using the same eligibility rules as native tools. Each listed name SHALL be the connector `id`, an underscore, and the tool's short name. The process SHALL add the same required `account` property as for native tools: type `string`, an `enum` of only the eligible account ids, and a `description` that lists each as `<id> (<label>)`. Account field values, including secrets, SHALL NOT appear in the tool schema. `tools/list` SHALL NOT start a child process. A tool the child serves that is not on the connector allowlist SHALL NOT appear. The listed argument schema SHALL be the allowlist schema plus the injected `account` property, not the schema from the child's `tools/list`.

#### Scenario: Allowlisted tools are listed with prefix and account and list starts no child

- **GIVEN** the MCP app is created with an injected registry whose proxy connector allowlist is only `echo_args` and `leak_secret`, and with a store whose enabled configuration includes one enabled account of that connector
- **AND** the connector's extra child arguments include a launch-count file that starts at 0
- **AND** the plaintext bearer of that configuration is known to the test
- **WHEN** an MCP client authenticates with that bearer and calls `tools/list`
- **THEN** the listed tools include `<connector id>_echo_args` and `<connector id>_leak_secret`
- **AND** each listed tool's input schema requires property `account`
- **AND** `account.enum` contains only that eligible account id
- **AND** `account.description` contains `<id> (<label>)` for that account
- **AND** the serialized tool schema does not contain that account's secret field value
- **AND** the launch count stays 0

#### Scenario: Tools off the allowlist do not appear

- **GIVEN** the same app, store, and proxy connector as the previous scenario
- **AND** the installed fake also serves `report_env` and `crash`, which are not on the allowlist
- **WHEN** an MCP client authenticates with that configuration's bearer and calls `tools/list`
- **THEN** the listed tool names do not include `<connector id>_report_env` or `<connector id>_crash`
- **AND** the launch count stays 0

#### Scenario: No eligible account hides proxy tools

- **GIVEN** the MCP app with that proxy connector and an enabled configuration whose `accountIds` do not include an enabled account of that connector
- **WHEN** an MCP client authenticates with that configuration's bearer and calls `tools/list`
- **THEN** the listed tools array does not include that connector's allowlisted tools

### Requirement: Proxy tools/call strips account and calls the child by short name

On `tools/call` for an allowlisted proxy tool, the process SHALL validate the arguments against the allowlist JSON Schema including the injected `account` property, then SHALL verify that `account` is an eligible account for that connector under the active configuration. On validation or eligibility failure the process SHALL return a short English MCP error and SHALL NOT start a child. On success the process SHALL remove `account` and SHALL call the existing proxy runtime with the tool's short name and the remaining arguments. The child SHALL start on that first successful call for the account. The process SHALL NOT send the public prefixed name to the child. The process SHALL NOT send `account` to the child. The descriptor entry path and extra arguments SHALL come from the connector module. The descriptor variables SHALL be only the connector's field-to-variable bindings for the selected account. The argument schema SHALL be the allowlist schema, not the child's `tools/list` schema.

#### Scenario: echo_args receives arguments without account

- **GIVEN** the MCP app with an injected proxy connector whose allowlist includes `echo_args` with an object schema that requires a string property `note` and does not declare `account`, and an enabled configuration with one eligible account
- **AND** the connector maps no account field into the arguments
- **AND** the launch-count file starts at 0
- **WHEN** an MCP client authenticates with that configuration's bearer and calls `<connector id>_echo_args` with `account` set to that account id and `note` set to `hello`
- **THEN** the call succeeds
- **AND** the launch count is 1
- **AND** the tool result text is JSON whose `note` value is `hello`
- **AND** the tool result text does not contain that account id as an `account` property

#### Scenario: Allowlist schema rejects a call the child would accept

- **GIVEN** the same proxy connector, where the allowlist schema for `echo_args` requires `note`, and the fake's own `echo_args` schema does not require `note`
- **AND** the launch-count file starts at 0
- **WHEN** an MCP client calls `<connector id>_echo_args` with a valid `account` and without `note`
- **THEN** the response is an MCP error with short English text
- **AND** the launch count stays 0

#### Scenario: Ineligible account does not start the child

- **GIVEN** the MCP app with that proxy connector, an enabled account of that connector, and an enabled configuration whose `accountIds` do not include that account
- **AND** the launch-count file starts at 0
- **WHEN** an MCP client authenticates with that configuration's bearer and calls `<connector id>_echo_args` with `account` set to that account id and a valid `note`
- **THEN** the response is an MCP error with short English text
- **AND** the launch count stays 0

#### Scenario: Non-allowlisted tool name does not start the child

- **GIVEN** the MCP app with that proxy connector, whose allowlist does not include `report_env`, and an enabled configuration with an eligible account
- **AND** the launch-count file starts at 0
- **WHEN** an MCP client authenticates with that configuration's bearer and calls `<connector id>_report_env` with `account` set to that account id
- **THEN** the response is an MCP error with short English text
- **AND** the launch count stays 0

### Requirement: Proxy tool result scrubs secrets and omits stderr

Before the MCP client sees a successful proxy tool result, the process SHALL replace every non-empty account field value of type `secret` for the selected account with the literal `[redacted]` in the result text, using the same scrub as native tool results (longer secret values before shorter ones). The process SHALL NOT copy the child's stderr into the MCP response.

#### Scenario: Secret in the result is redacted and the stderr marker is absent

- **GIVEN** the MCP app with an injected proxy connector whose allowlist includes `leak_secret`, whose env bindings map the account's secret field to the child variable `TOKEN`, and an enabled configuration with that eligible account
- **AND** the secret field value is a known non-empty string that is not `fake-stdio-mcp-stderr-marker`
- **WHEN** an MCP client authenticates with that configuration's bearer and calls `<connector id>_leak_secret` with `account` set to that account id
- **THEN** the call succeeds
- **AND** the MCP tool result text contains `[redacted]`
- **AND** the MCP tool result text does not contain the secret string
- **AND** the MCP tool result text does not contain `fake-stdio-mcp-stderr-marker`
