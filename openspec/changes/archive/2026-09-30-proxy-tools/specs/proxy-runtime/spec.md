# Spec Delta

## ADDED Requirements

### Requirement: Production registry has no proxy connector

The production connector registry SHALL include the Gmail connector and SHALL NOT include a proxy connector. Building a registry that contains a valid proxy module SHALL NOT start a child process. That registration rule is the proxy allowlist in `connector-contract`. This requirement does not put a proxy connector into the production registry.

#### Scenario: Production registry includes Gmail and no proxy connector

- **GIVEN** the production connector registry
- **WHEN** its public connector list is read
- **THEN** the list includes a connector with `id` `gmail`
- **AND** no listed connector has `kind` `proxy`

### Requirement: Fake stdio server echo and leak tools

The fake stdio MCP server package at `packages/fake-stdio-mcp` SHALL stay at package version exactly `1.0.0`. It SHALL keep the tools `report_env` and `crash`. It SHALL also expose a tool named `echo_args` whose text result is the JSON of the arguments object received on `tools/call`, and a tool named `leak_secret` whose text result contains the value of the child environment variable `TOKEN`. `leak_secret` SHALL write the exact marker `fake-stdio-mcp-stderr-marker` to stderr. That marker SHALL NOT be a secret and SHALL NOT be copied into the tool result text. The package SHALL NOT be downloaded at spawn and SHALL NOT be invoked through `npx`.

#### Scenario: echo_args returns the arguments it received

- **GIVEN** the installed fake server is running
- **WHEN** the caller invokes `echo_args` with an arguments object that has a string property `note` and no `account` property
- **THEN** the tool result text is JSON for that same arguments object
- **AND** the result text does not contain a property named `account`

#### Scenario: leak_secret returns TOKEN and writes the stderr marker

- **GIVEN** the installed fake server is spawned with environment variable `TOKEN` set to a known non-empty string that is not `fake-stdio-mcp-stderr-marker`
- **AND** the test captures that process's stderr
- **WHEN** the caller invokes `leak_secret`
- **THEN** the tool result text contains that `TOKEN` value
- **AND** the captured stderr contains `fake-stdio-mcp-stderr-marker`
- **AND** the tool result text does not contain `fake-stdio-mcp-stderr-marker`

## REMOVED Requirements

### Requirement: Production registry still rejects proxy

**Reason**: A proxy module with a valid allowlist is registrable. Hard rejection of every `kind: proxy` module is replaced. Registry build still does not start a child, and the production registry still has no proxy connector.

**Migration**: Use the added requirement "Production registry has no proxy connector" for the production list. Use the `connector-contract` proxy allowlist scenarios for registration without starting a child.
