# Spec Delta

## ADDED Requirements

### Requirement: Proxy connector tool allowlist

A module with `kind` equal to `proxy` SHALL declare the same `id`, `name`, `fields`, `allowedDestinations`, and `checkConnection` as a native module, plus a `tools` allowlist. Each allowlisted tool SHALL have a short `name` (non-empty string matching `^[a-z0-9_]+$`, unique within the connector), an English `description` (non-empty string), and an arguments JSON Schema that is an object schema. A proxy tool SHALL NOT declare a handler. Building the registry SHALL fail when a proxy tool declares a handler, or when a proxy tool's arguments schema declares a property named `account`. An empty allowlist SHALL be valid and SHALL expose no tools. The module SHALL also declare a non-empty entry path string and a list of extra child arguments. An empty extra-arguments list SHALL be valid. The module SHALL declare zero or more bindings from an account field `name` on that same connector to a non-empty child environment variable name. The entry path and the extra arguments SHALL be connector code. Registry build SHALL NOT read the entry file and SHALL NOT start a child process. A binding that does not name a field on that connector SHALL fail registry build. The fake proxy connector's `checkConnection` SHALL NOT start a child process.

#### Scenario: Empty proxy allowlist registers and starts no child

- **GIVEN** a proxy module with a valid `id`, display `name`, at least one account field, at least one allowed destination, a `checkConnection` function, an empty tools allowlist, a non-empty entry path, an empty extra-arguments list, and no env bindings
- **WHEN** the registry is built with that module
- **THEN** registry build succeeds
- **AND** the built registry includes that connector by `id`
- **AND** the built registry exposes no tools for that connector
- **AND** no child process is started

#### Scenario: Proxy tool schema that declares account fails registry build

- **GIVEN** a proxy module whose allowlist has one tool whose arguments schema includes a property named `account`, and that tool has no handler
- **WHEN** the registry is built with that module
- **THEN** registry build fails
- **AND** no child process is started

#### Scenario: Proxy tool with a handler fails registry build

- **GIVEN** a proxy module whose allowlist has one tool that declares a handler function
- **WHEN** the registry is built with that module
- **THEN** registry build fails
- **AND** no child process is started

#### Scenario: Env binding must name a field on the connector

- **GIVEN** a proxy module whose only account field is `token` and whose env bindings include a field name `missing`
- **WHEN** the registry is built with that module
- **THEN** registry build fails
- **AND** no child process is started

#### Scenario: Fake proxy checkConnection does not spawn

- **GIVEN** a proxy module that has built into a registry, whose `checkConnection` does not spawn a child, and whose extra child arguments include a launch-count file that starts at 0
- **WHEN** the test invokes `checkConnection` with account field values and an egress client
- **THEN** the invocation completes without throwing
- **AND** the launch count stays 0

### Requirement: Registry build validates modules

The process SHALL build the connector registry from a code array of connector modules. Building the registry SHALL fail when any connector has an invalid `id`, a duplicate `id` within the array, an invalid account field (bad `name`, duplicate `name` within the connector, bad `type`), an invalid allowed destination, or an invalid proxy allowlist. Building the registry SHALL NOT fail solely because `kind` is `proxy` when that module's allowlist is valid. Building the registry SHALL NOT start a child process. There SHALL be no runtime connector catalog, no HTTP API that adds connectors, and no configuration file of connectors.

#### Scenario: Duplicate id fails registry build

- **GIVEN** two fake native connectors that both use `id` `fake`
- **WHEN** the registry is built from an array containing both
- **THEN** registry build fails

#### Scenario: Bad id fails registry build

- **GIVEN** a fake connector with `id` `Bad_Id` (does not match `^[a-z0-9]+$`) and otherwise valid native shape
- **WHEN** the registry is built with that connector
- **THEN** registry build fails

#### Scenario: Valid proxy allowlist registers and starts no child

- **GIVEN** a proxy module with a valid `id`, one allowlisted tool whose short name is `echo`, an English description, an object arguments schema without an `account` property, no handler, a non-empty entry path, and a launch-count file among its extra child arguments that starts at 0
- **WHEN** the registry is built with that module
- **THEN** registry build succeeds
- **AND** the built registry exposes that tool under the MCP name formed as `<connector id>_echo`
- **AND** the launch count stays 0

## MODIFIED Requirements

### Requirement: Native connector module shape

A connector module SHALL declare `id` (string matching `^[a-z0-9]+$`), `name` (non-empty display string), `kind` with TypeScript type `native | proxy`, `fields` (account field descriptions), `allowedDestinations` (host and port pairs), and a `checkConnection` function. Modules with `kind` equal to `native` and modules with `kind` equal to `proxy` SHALL be registrable when they satisfy the rules for that kind. A `kind` of `proxy` SHALL follow the proxy connector tool allowlist requirement. The `checkConnection` function SHALL accept account field values and the gateway-built egress client for that account, and SHALL NOT be exposed as an HTTP route. A field of type `host` means a hostname only: no scheme, no path, no userinfo, and no port in the value (enforcement of entered values belongs to accounts validation).

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

## REMOVED Requirements

### Requirement: Registry build validates and rejects proxy

**Reason**: A valid `kind: proxy` allowlist is registrable. The requirement no longer rejects every proxy module, so the scenario "Proxy kind fails registry build" does not carry forward.

**Migration**: Use the added requirement "Registry build validates modules". Duplicate id and bad id still fail the build. A valid proxy allowlist registers and starts no child.
