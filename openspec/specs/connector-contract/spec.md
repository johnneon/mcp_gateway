# connector-contract Specification

## Purpose

Defines the native connector module contract, account field and allowed-destination shapes, the connection-check function on the module, and the in-code registry that validates at build time and ships empty in production.

## Requirements

### Requirement: Native connector module shape

A connector module SHALL declare `id` (string matching `^[a-z0-9]+$`), `name` (non-empty display string), `kind` with TypeScript type `native | proxy`, `fields` (account field descriptions), `allowedDestinations` (host and port pairs), and a `checkConnection` function. Only modules with `kind` equal to `native` SHALL be registrable. The `checkConnection` function SHALL accept account field values and SHALL NOT be exposed as an HTTP route in this change. A field of type `host` means a hostname only: no scheme, no path, no userinfo, and no port in the value (enforcement of entered values belongs to a later accounts change).

#### Scenario: Fake native connector satisfies the contract

- **GIVEN** a fake connector module with `kind` `native`, a valid `id`, a display `name`, at least one account field, at least one allowed destination, and a `checkConnection` function that resolves without contacting a live provider
- **WHEN** the module is built into a registry
- **THEN** registry build succeeds
- **AND** the built registry includes that connector by `id`

#### Scenario: Connection check is callable without HTTP exposure

- **GIVEN** a fake native connector whose `checkConnection` resolves successfully for a fixed fake account-values object
- **WHEN** the test invokes `checkConnection` with those values
- **THEN** the invocation completes without throwing
- **AND** no HTTP route under `/api` invokes that function as a result of this change

### Requirement: Account field description

Each account field SHALL have `name` (string matching `^[a-z0-9]+$`, unique within the connector), `label` (non-empty display string), `type` equal to one of `text`, `secret`, or `host`, and `required` (boolean).

#### Scenario: Valid fields are accepted

- **GIVEN** a fake native connector whose fields are `{ name: "user", label: "User", type: "text", required: true }` and `{ name: "token", label: "Token", type: "secret", required: true }` and `{ name: "mailhost", label: "Mail host", type: "host", required: true }`
- **WHEN** the registry is built with that connector
- **THEN** registry build succeeds

### Requirement: Allowed destinations as host and port pairs

Each allowed destination SHALL be either a constant `{ host, port }` where `host` is a non-empty hostname string and `port` is an integer port declared in connector code, or an operator-entered host `{ field, port }` where `field` is the `name` of an account field of type `host` on the same connector and `port` is an integer port declared in connector code. The shape exists so a later Gmail connector can declare `imap.gmail.com:993` and `smtp.gmail.com:465` as constants; this change SHALL NOT register a Gmail connector.

#### Scenario: Constant and field-backed destinations are accepted

- **GIVEN** a fake native connector with a `host` field named `mailhost` and allowed destinations `[{ host: "imap.example.test", port: 993 }, { field: "mailhost", port: 993 }]`
- **WHEN** the registry is built with that connector
- **THEN** registry build succeeds

#### Scenario: Field-backed destination must name a host field

- **GIVEN** a fake native connector whose only fields are type `text` and whose allowed destinations include `{ field: "missing", port: 993 }`
- **WHEN** the registry is built with that connector
- **THEN** registry build fails

### Requirement: Registry build validates and rejects proxy

The process SHALL build the connector registry from a code array of connector modules. Building the registry SHALL fail when any connector has an invalid `id`, a duplicate `id` within the array, an invalid account field (bad `name`, duplicate `name` within the connector, bad `type`), an invalid allowed destination, or `kind` equal to `proxy`. There SHALL be no runtime connector catalog, no HTTP API that adds connectors, and no configuration file of connectors.

#### Scenario: Duplicate id fails registry build

- **GIVEN** two fake native connectors that both use `id` `fake`
- **WHEN** the registry is built from an array containing both
- **THEN** registry build fails

#### Scenario: Bad id fails registry build

- **GIVEN** a fake connector with `id` `Bad_Id` (does not match `^[a-z0-9]+$`) and otherwise valid native shape
- **WHEN** the registry is built with that connector
- **THEN** registry build fails

#### Scenario: Proxy kind fails registry build

- **GIVEN** a connector module with `kind` `proxy` and an otherwise complete description
- **WHEN** the registry is built with that connector
- **THEN** registry build fails
- **AND** no child process is started

### Requirement: Production registry is empty

The production connector registry export SHALL be an empty built registry (zero connectors). Tests SHALL pass their own registry, including a fake native connector when needed, into the admin app factory instead of relying on the production export.

#### Scenario: Production export has no connectors

- **GIVEN** the production connector registry module
- **WHEN** its public connector list is read
- **THEN** the list length is 0
