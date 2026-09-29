# Spec Delta

## MODIFIED Requirements

### Requirement: Native connector tools

A native connector module SHALL declare a `tools` array. Each tool SHALL have a short `name` (non-empty string matching `^[a-z0-9_]+$`, unique within the connector), an English `description` (non-empty string), an arguments JSON Schema (an object schema describing model arguments), and a `handler` function. The MCP tool name for a tool SHALL be the concatenation of the connector `id`, an underscore, and the tool `name` (for example `fake_echo`). The `handler` SHALL accept the model arguments with the gateway-injected `account` property removed, the decrypted account field values for the selected account, and the gateway-built egress client for that account. The `checkConnection` function SHALL NOT receive the egress client in this change. Building the registry SHALL fail when any tool's own arguments schema declares a property named `account`. The production connector registry SHALL remain empty. Tests SHALL pass a registry that includes a fake native connector with tools into the MCP app factory when asserting tool list and call behavior.

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

#### Scenario: Handler receives egress client; checkConnection does not

- **GIVEN** a fake native connector whose tool handler records whether it received an egress client argument, and whose `checkConnection` records its argument list length
- **AND** the MCP app is created with a registry built from that fake and a store with an eligible account included in an enabled configuration
- **WHEN** an MCP client authenticates with that configuration's bearer and successfully calls the fake tool
- **THEN** the handler-recorded egress client is present
- **AND** invoking `checkConnection` with only account field values still completes without an egress client argument
