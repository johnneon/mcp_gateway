# Spec Delta

## MODIFIED Requirements

### Requirement: tools/list from eligible accounts only

After authentication, `tools/list` SHALL be built per request from the active configuration and the injected connector registry. A tool SHALL appear in the list only when the active configuration has at least one account eligible for that tool. An account is eligible for a connector when its id is listed in the configuration's `accountIds`, the account exists in the store, `enabled` is true, and its `connector` equals that connector's id. An account is eligible for a tool only when it is eligible for that tool's connector and the tool is enabled for that account. A tool is enabled for an account when the configuration has no `disabledTools` property, when `disabledTools` has no key for that account id, or when that key's array does not contain the tool's MCP name. A missing key or an empty array means every tool of that connector is enabled for that account. Disabling the whole account (`enabled` false) or the whole configuration SHALL stay as already specified and SHALL NOT be replaced by `disabledTools`. When no tool has any eligible account, or the registry has no connectors, `tools/list` SHALL return an empty tool array. Existing empty `tools/list` behavior for an empty production registry SHALL stay intact. The process SHALL NOT expose an MCP tool that reads or writes `disabledTools`.

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

#### Scenario: Missing denylist lists every tool for the assigned account

- **GIVEN** the MCP app with a fake connector that declares tools `keep` and `drop`, one enabled account of that connector, and an enabled configuration that includes that account and has no `disabledTools` property
- **WHEN** an MCP client authenticates with that configuration's bearer and calls `tools/list`
- **THEN** the listed tools include `<connector id>_keep` and `<connector id>_drop`
- **AND** each tool's `account` enum contains that account id

#### Scenario: Tool omitted when every assigned account has it disabled

- **GIVEN** the MCP app with a fake connector that declares tools `keep` and `drop`, one enabled account of that connector, and an enabled configuration whose `accountIds` contain only that account and whose `disabledTools` for that account is `["<connector id>_drop"]`
- **WHEN** an MCP client authenticates with that configuration's bearer and calls `tools/list`
- **THEN** the listed tools include `<connector id>_keep`
- **AND** the listed tools do not include `<connector id>_drop`

#### Scenario: Same account on another configuration still lists the tool

- **GIVEN** one enabled account of a fake connector that declares tool `drop`, and two enabled configurations that both include that account
- **AND** only the first configuration stores `disabledTools` for that account as `["<connector id>_drop"]`
- **WHEN** an MCP client authenticates with the second configuration's bearer and calls `tools/list`
- **THEN** the listed tools include `<connector id>_drop`
- **AND** that tool's `account` enum contains that account id

### Requirement: Injected account argument in tool schemas

For every tool exposed in `tools/list`, the process SHALL add a required `account` property to the tool's input JSON Schema. The property SHALL have type `string` and an `enum` containing only the ids of accounts eligible for that tool. The property `description` SHALL list those accounts for clients, one entry per account, each formatted as `<id> (<label>)`. The schema SHALL NOT use `oneOf`, `const`, or `title` to carry account labels. Account field values, including secrets, SHALL NOT appear in the tool schema. An account for which that tool is disabled SHALL be omitted from that tool's `account` enum and from that property's description.

#### Scenario: Account enum and description show only eligible accounts

- **GIVEN** the MCP app with a fake connector tool and an enabled configuration whose eligible accounts are one account with a known id and label
- **WHEN** an MCP client authenticates with that configuration's bearer and calls `tools/list`
- **THEN** the tool's input schema requires property `account`
- **AND** `account.enum` equals an array containing only that account id
- **AND** `account.description` contains the substring `<id> (<label>)` for that account
- **AND** the serialized tool schema does not contain any stored secret field value of that account

#### Scenario: Disabled account is omitted from that tool's enum only

- **GIVEN** the MCP app with a fake connector that declares tools `keep` and `drop`, and an enabled configuration with two enabled accounts of that connector, `a1` and `a2`
- **AND** `disabledTools` for `a1` is `["<connector id>_drop"]` and `a2` has no disabled tools
- **WHEN** an MCP client authenticates with that configuration's bearer and calls `tools/list`
- **THEN** `<connector id>_drop` has `account.enum` equal to `["a2"]` only, in configuration account order among the accounts that remain
- **AND** `<connector id>_keep` has `account.enum` containing both `a1` and `a2`
- **AND** the `account.description` of `<connector id>_drop` does not contain `a1`

### Requirement: tools/call validates, authorizes, then invokes handler

On `tools/call`, the process SHALL locate the tool by its MCP name. Before JSON Schema validation, when the `account` argument is a string that identifies an account which is otherwise eligible for the tool's connector under the active configuration (the id is in `accountIds`, the account exists, `enabled` is true, and its connector matches) and that tool is disabled for that account, the process SHALL return an MCP error whose message is exactly `Tool is disabled for this account` and SHALL NOT invoke the connector handler and SHALL NOT start a proxy child. This refusal SHALL be returned even though that account id is omitted from the `account` enum, so the client SHALL NOT receive only `Invalid tool arguments` for that case. A tool is disabled for an account when the active configuration's `disabledTools` has that account id as a key and the array contains that tool's MCP name. The process SHALL then validate the call arguments against the tool's JSON Schema including the injected `account` property, using JSON Schema validation. On validation failure the process SHALL return a short English MCP error and SHALL NOT invoke the connector handler. After successful validation, the process SHALL verify that the `account` argument identifies an eligible account for the tool's connector under the active configuration (id in `accountIds`, account enabled, connector matches) and that the tool is enabled for that account. If the account is not eligible, the process SHALL return a short English MCP error and SHALL NOT invoke the handler. If the account is eligible and the tool is disabled, the process SHALL return an MCP error whose message is exactly `Tool is disabled for this account` and SHALL NOT invoke the handler. On success the process SHALL build an egress client for that account from the connector's allowed destinations and SHALL invoke the handler with the model arguments with `account` removed, the decrypted account field values, and that egress client. When the handler fails because of an egress network error whose message is one of `Destination is not allowed`, `Redirect is not allowed`, `Connection failed`, or `Response too large`, the process SHALL return that same short English phrase as the MCP error and SHALL NOT replace it with `Tool execution failed`. If the handler throws any other error, the process SHALL return a fixed English MCP error that does not include the exception text and SHALL NOT include account secret values.

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

#### Scenario: Disabled tool returns the fixed error and does not call the handler

- **GIVEN** the MCP app with a fake connector whose tools are `keep` and `drop` and whose call counters start at 0, one enabled account of that connector on an enabled configuration, and `disabledTools` for that account containing only `<connector id>_drop`
- **WHEN** an MCP client authenticates with that configuration's bearer and calls `<connector id>_drop` with `account` set to that account id and arguments that would otherwise be valid
- **THEN** the response is an MCP error whose message is exactly `Tool is disabled for this account`
- **AND** the message is not `Invalid tool arguments`
- **AND** the `drop` call counter equals 0
- **WHEN** the client calls `<connector id>_keep` with that same account id and valid arguments
- **THEN** the call succeeds
- **AND** the `keep` call counter equals 1

#### Scenario: gmail_delete_message off on one configuration leaves the other path working

- **GIVEN** the MCP app with the Gmail connector and a fake IMAP transport, one enabled Gmail account assigned to two enabled configurations that do not share a bearer, and configuration A's `disabledTools` for that account containing `gmail_delete_message` while configuration B stores no denylist for that account
- **WHEN** an MCP client authenticates with configuration A's bearer and calls `gmail_delete_message` for that account
- **THEN** the response is an MCP error whose message is exactly `Tool is disabled for this account`
- **AND** the fake IMAP transport receives no command for that call
- **WHEN** the same client calls `gmail_list_mailboxes` for that account
- **THEN** the call succeeds
- **WHEN** an MCP client authenticates with configuration B's bearer and calls `gmail_delete_message` for that account with valid arguments against the fake IMAP server
- **THEN** the call succeeds

### Requirement: Proxy tools/list from the in-code allowlist

After authentication, `tools/list` SHALL include a proxy connector's allowlisted tool only when the active configuration has at least one account eligible for that tool, using the same per-tool eligibility rules as native tools, including `disabledTools`. Each listed name SHALL be the connector `id`, an underscore, and the tool's short name. The process SHALL add the same required `account` property as for native tools: type `string`, an `enum` of only the account ids eligible for that tool, and a `description` that lists each as `<id> (<label>)`. Account field values, including secrets, SHALL NOT appear in the tool schema. `tools/list` SHALL NOT start a child process. A tool the child serves that is not on the connector allowlist SHALL NOT appear. The listed argument schema SHALL be the allowlist schema plus the injected `account` property, not the schema from the child's `tools/list`.

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

#### Scenario: Disabled proxy tool is absent when no account may use it

- **GIVEN** the MCP app with that proxy connector, one enabled account of that connector on an enabled configuration, and `disabledTools` for that account containing `<connector id>_echo_args` and not `<connector id>_leak_secret`
- **AND** the launch-count file starts at 0
- **WHEN** an MCP client authenticates with that configuration's bearer and calls `tools/list`
- **THEN** the listed tool names do not include `<connector id>_echo_args`
- **AND** the listed tool names include `<connector id>_leak_secret`
- **AND** the launch count stays 0

### Requirement: Proxy tools/call strips account and calls the child by short name

On `tools/call` for an allowlisted proxy tool, before JSON Schema validation, when the `account` argument identifies an otherwise eligible account for which that tool is disabled, the process SHALL return an MCP error whose message is exactly `Tool is disabled for this account` and SHALL NOT start a child. The process SHALL then validate the arguments against the allowlist JSON Schema including the injected `account` property, then SHALL verify that `account` is an eligible account for that connector under the active configuration and that the tool is enabled for that account. On validation or eligibility failure the process SHALL return a short English MCP error and SHALL NOT start a child. On the disabled-tool failure the process SHALL return the message `Tool is disabled for this account` and SHALL NOT start a child. On success the process SHALL remove `account` and SHALL call the existing proxy runtime with the tool's short name and the remaining arguments. The child SHALL start on that first successful call for the account. The process SHALL NOT send the public prefixed name to the child. The process SHALL NOT send `account` to the child. The descriptor entry path and extra arguments SHALL come from the connector module. The descriptor variables SHALL be only the connector's field-to-variable bindings for the selected account. The argument schema SHALL be the allowlist schema, not the child's `tools/list` schema.

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

#### Scenario: Disabled proxy tool does not start the child

- **GIVEN** the MCP app with that proxy connector, one eligible account, and `disabledTools` for that account containing `<connector id>_echo_args`
- **AND** the launch-count file starts at 0
- **WHEN** an MCP client authenticates with that configuration's bearer and calls `<connector id>_echo_args` with `account` set to that account id and `note` set to `hello`
- **THEN** the response is an MCP error whose message is exactly `Tool is disabled for this account`
- **AND** the launch count stays 0
