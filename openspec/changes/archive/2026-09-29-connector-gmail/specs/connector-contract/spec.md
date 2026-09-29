# Spec Delta

## ADDED Requirements

### Requirement: Production registry includes registered product connectors

The production connector registry export SHALL be a built registry that includes every product connector module registered in code for this process (including Gmail when this change ships). Tests that need a fake connector SHALL pass their own registry into the admin or MCP app factory and SHALL NOT rely on the production export containing that fake.

#### Scenario: Production export includes Gmail

- **GIVEN** the production connector registry module
- **WHEN** its public connector list is read
- **THEN** the list length is at least 1
- **AND** the list includes a connector with `id` `gmail`

#### Scenario: Tests inject a fake instead of using production for fake assertions

- **GIVEN** a test that needs a fake native connector id that is not a product connector
- **WHEN** the admin or MCP app is created for that test
- **THEN** the test passes a registry built with that fake into the app factory
- **AND** the production registry export is not required to contain that fake

## MODIFIED Requirements

### Requirement: Native connector module shape

A connector module SHALL declare `id` (string matching `^[a-z0-9]+$`), `name` (non-empty display string), `kind` with TypeScript type `native | proxy`, `fields` (account field descriptions), `allowedDestinations` (host and port pairs), and a `checkConnection` function. Only modules with `kind` equal to `native` SHALL be registrable. The `checkConnection` function SHALL accept account field values and the gateway-built egress client for that account, and SHALL NOT be exposed as an HTTP route. A field of type `host` means a hostname only: no scheme, no path, no userinfo, and no port in the value (enforcement of entered values belongs to accounts validation).

#### Scenario: Fake native connector satisfies the contract

- **GIVEN** a fake connector module with `kind` `native`, a valid `id`, a display `name`, at least one account field, at least one allowed destination, and a `checkConnection` function that resolves without contacting a live provider
- **WHEN** the module is built into a registry
- **THEN** registry build succeeds
- **AND** the built registry includes that connector by `id`

#### Scenario: Connection check is callable without HTTP exposure

- **GIVEN** a fake native connector whose `checkConnection` resolves successfully for a fixed fake account-values object and a fake egress client
- **WHEN** the test invokes `checkConnection` with those values and that egress client
- **THEN** the invocation completes without throwing
- **AND** no HTTP route under `/api` invokes that function as a raw connector export bypassing the accounts service

### Requirement: Allowed destinations as host and port pairs

Each allowed destination SHALL be either a constant `{ host, port }` where `host` is a non-empty hostname string and `port` is an integer port declared in connector code, or an operator-entered host `{ field, port }` where `field` is the `name` of an account field of type `host` on the same connector and `port` is an integer port declared in connector code. Product connectors such as Gmail MAY register constant destinations (for example `imap.gmail.com:993` and `smtp.gmail.com:465`).

#### Scenario: Constant and field-backed destinations are accepted

- **GIVEN** a fake native connector with a `host` field named `mailhost` and allowed destinations `[{ host: "imap.example.test", port: 993 }, { field: "mailhost", port: 993 }]`
- **WHEN** the registry is built with that connector
- **THEN** registry build succeeds

#### Scenario: Field-backed destination must name a host field

- **GIVEN** a fake native connector whose only fields are type `text` and whose allowed destinations include `{ field: "missing", port: 993 }`
- **WHEN** the registry is built with that connector
- **THEN** registry build fails

### Requirement: Native connector tools

A native connector module SHALL declare a `tools` array. Each tool SHALL have a short `name` (non-empty string matching `^[a-z0-9_]+$`, unique within the connector), an English `description` (non-empty string), an arguments JSON Schema (an object schema describing model arguments), and a `handler` function. The MCP tool name for a tool SHALL be the concatenation of the connector `id`, an underscore, and the tool `name` (for example `fake_echo`). The `handler` SHALL accept the model arguments with the gateway-injected `account` property removed, the decrypted account field values for the selected account, and the gateway-built egress client for that account. The `checkConnection` function SHALL accept the account field values and the same gateway-built egress client for that account. Building the registry SHALL fail when any tool's own arguments schema declares a property named `account`. The production connector registry SHALL include registered product connectors. Tests SHALL pass a registry that includes a fake native connector with tools into the MCP app factory when asserting tool list and call behavior, and SHALL NOT rely on the production export containing that fake.

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
- **THEN** the list length is at least 1
- **AND** the list includes `id` `gmail`
- **AND** the list is no longer required to be empty (product connectors are registered in production)

#### Scenario: Handler receives egress client; checkConnection does not

- **GIVEN** a fake native connector whose tool handler records whether it received an egress client argument, and whose `checkConnection` records whether it received an egress client argument
- **AND** the MCP app is created with a registry built from that fake and a store with an eligible account included in an enabled configuration
- **WHEN** an MCP client authenticates with that configuration's bearer and successfully calls the fake tool
- **THEN** the handler-recorded egress client is present
- **AND** invoking `checkConnection` with account field values and an egress client records that the egress client argument was present

### Requirement: MCP app accepts an injectable connector registry

`createMcpApp` SHALL accept a connector registry alongside the encrypted store. The production process SHALL pass the production connector registry (including registered product connectors such as Gmail). Tests SHALL inject a registry built with a fake native connector (with tools) into the MCP app the same way they inject a registry into the admin app, and SHALL NOT rely on the production export containing that fake.

#### Scenario: MCP app with injected fake registry can list tools for an eligible account

- **GIVEN** the MCP app is created with a store that has one enabled configuration whose `accountIds` include one enabled account of a fake native connector that declares a tool, and with a connector registry built from that fake
- **AND** the plaintext bearer of that configuration is known to the test
- **WHEN** an MCP client authenticates with that bearer and calls `tools/list`
- **THEN** the listed tools include the fake connector's tool under its MCP name
- **AND** the production registry export still includes product connectors such as `gmail` and is not required to contain the fake

## REMOVED Requirements

### Requirement: Production registry is empty

**Reason**: This change registers the Gmail product connector in the production registry export; an empty production registry is no longer correct.

**Migration**: Use the added requirement "Production registry includes registered product connectors". Tests that need fakes continue to inject their own registry.
