# Spec Delta

## ADDED Requirements

### Requirement: Native connector tools

A native connector module SHALL declare a `tools` array. Each tool SHALL have a short `name` (non-empty string matching `^[a-z0-9_]+$`, unique within the connector), an English `description` (non-empty string), an arguments JSON Schema (an object schema describing model arguments), and a `handler` function. The MCP tool name for a tool SHALL be the concatenation of the connector `id`, an underscore, and the tool `name` (for example `fake_echo`). The `handler` SHALL accept the model arguments with the gateway-injected `account` property removed and the decrypted account field values for the selected account. Building the registry SHALL fail when any tool's own arguments schema declares a property named `account`. The production connector registry SHALL remain empty. Tests SHALL pass a registry that includes a fake native connector with tools into the MCP app factory when asserting tool list and call behavior.

#### Scenario: Fake native connector with tools builds into a registry

- **GIVEN** a fake native connector with a valid `id`, one tool whose short name is `echo`, an English description, an object arguments schema without an `account` property, and a handler that does not contact a live provider
- **WHEN** the registry is built with that connector
- **THEN** registry build succeeds
- **AND** the built registry exposes that tool under the MCP name formed as `<connector id>_echo`

#### Scenario: Tool schema that declares account fails registry build

- **GIVEN** a fake native connector whose tool arguments schema includes a property named `account`
- **WHEN** the registry is built with that connector
- **THEN** registry build fails

#### Scenario: Production registry stays empty

- **GIVEN** the production connector registry module
- **WHEN** its public connector list is read
- **THEN** the list length is 0

### Requirement: MCP app accepts an injectable connector registry

`createMcpApp` SHALL accept a connector registry alongside the encrypted store. The production process SHALL pass the empty production registry. Tests SHALL inject a registry built with a fake native connector (with tools) into the MCP app the same way they inject a registry into the admin app, and SHALL NOT rely on the production export containing that fake.

#### Scenario: MCP app with injected fake registry can list tools for an eligible account

- **GIVEN** the MCP app is created with a store that has one enabled configuration whose `accountIds` include one enabled account of a fake native connector that declares a tool, and with a connector registry built from that fake
- **AND** the plaintext bearer of that configuration is known to the test
- **WHEN** an MCP client authenticates with that bearer and calls `tools/list`
- **THEN** the listed tools include the fake connector's tool under its MCP name
- **AND** the production registry export still has length 0
