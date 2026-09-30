# Spec Delta

## Purpose

Runs one stdio MCP child process per account from an already installed pinned package, and gives that process an environment that does not inherit the gateway.

## ADDED Requirements

### Requirement: Pinned package and spawn without download

The repository SHALL contain a fake stdio MCP server package at `packages/fake-stdio-mcp` whose own package version is exactly `1.0.0`. The server workspace SHALL depend on that package with the specifier `file:../packages/fake-stdio-mcp` and SHALL NOT use a version range. The package SHALL already be installed before a child starts. The runtime SHALL start the child with the current Node executable (`process.execPath`) and the absolute path of that installed entry file as the script argument. The runtime SHALL NOT download a package at spawn and SHALL NOT invoke `npx`. If the entry file is missing, the call SHALL fail and SHALL NOT start a child.

#### Scenario: Server depends on the exact installed package

- **GIVEN** the server workspace manifest and the fake package manifest
- **WHEN** those manifests are read
- **THEN** the fake package version is exactly `1.0.0`
- **AND** the server dependency on the fake package is exactly `file:../packages/fake-stdio-mcp`

#### Scenario: Child starts from the installed file

- **GIVEN** the fake package is installed and the runtime is given a descriptor whose entry path is the absolute path of that installed file
- **WHEN** the test calls the fake's environment-report tool for one account
- **THEN** the child process was started
- **AND** the child's executable is the current Node executable
- **AND** the child's script argument is that installed entry path
- **AND** the entry file existed before the call

#### Scenario: Missing entry file does not spawn

- **GIVEN** a descriptor whose entry path does not exist
- **WHEN** the test calls the runtime for that account
- **THEN** the call fails
- **AND** the launch count stays 0

### Requirement: One child process per account

The runtime SHALL keep at most one child process per account id. The process SHALL start on the first call for that account. A later call for the same account SHALL reuse the running child and SHALL NOT start another process. A different account id SHALL get its own child. Two calls for the same account that are in flight together SHALL share that one child.

#### Scenario: First call starts one process

- **GIVEN** no child is running for an account
- **WHEN** the test calls the fake's environment-report tool for that account
- **THEN** the launch count for that call is 1
- **AND** the tool result reports the environment the child received

#### Scenario: Second call reuses the running child

- **GIVEN** a child is already running for an account after one successful call
- **WHEN** the test calls the environment-report tool again for the same account
- **THEN** the launch count is still 1

#### Scenario: Two accounts get two processes

- **GIVEN** two account ids and two descriptors that map different variable values
- **WHEN** the test calls the environment-report tool once for each account
- **THEN** the launch count is 2
- **AND** each result reports only that account's mapped variable value

#### Scenario: Overlapping calls share one process

- **GIVEN** no child is running for an account
- **WHEN** two environment-report calls for that same account are started together before either returns
- **THEN** both calls succeed
- **AND** the launch count is 1

### Requirement: Idle stop and restart

The production idle timeout SHALL be 5 minutes (300000 milliseconds). The runtime SHALL accept an injected clock and an injected timeout. Tests SHALL NOT sleep for the production timeout. After the idle timeout elapses with no call, the runtime SHALL stop that account's child. The next call for that account SHALL start a new child.

#### Scenario: Production idle timeout is 5 minutes

- **GIVEN** the proxy runtime module
- **WHEN** the production idle timeout is read
- **THEN** it is 300000 milliseconds

#### Scenario: Injected clock stops the child and the next call starts a new one

- **GIVEN** a runtime constructed with an injected clock and an injected timeout shorter than 5 minutes
- **AND** one successful environment-report call has started a child for an account
- **WHEN** the test advances the injected clock by the injected timeout and applies the scheduled stop, without a real sleep
- **THEN** that child process is no longer running
- **AND** the launch count is still 1
- **WHEN** the test calls the environment-report tool again for the same account
- **THEN** the launch count is 2

### Requirement: Restart after the child exits

If the child exits before the next call, the runtime SHALL NOT restart it until that next call. The call that observes the exit SHALL fail with a short English error that does not include mapped account field values. The following call for that account SHALL start a new child.

#### Scenario: Next call after exit starts a new process

- **GIVEN** a child is running for an account
- **WHEN** that child exits
- **AND** the test calls the environment-report tool again for the same account
- **THEN** the launch count is 2

#### Scenario: In-flight call fails without the account secret

- **GIVEN** a child is running for an account whose mapped variable value is a known secret string
- **WHEN** that child exits during a call
- **THEN** the call fails
- **AND** the error text is English
- **AND** the error text does not contain that secret string

### Requirement: Child environment is built from scratch

The runtime SHALL build the child environment from an empty map. It SHALL copy `PATH` from the parent environment supplied to the runtime when that variable is present. When the platform supplied to the runtime is Windows, it SHALL also copy `SYSTEMROOT` when that variable is present. It SHALL NOT copy `SYSTEMROOT` when the platform is not Windows. It SHALL then set only the variables the descriptor maps from account fields. It SHALL NOT copy `TEMP`, `TMP`, `PATHEXT`, `HOME`, `USERPROFILE`, `ENCRYPTION_KEY`, or any other parent variable. The launch count SHALL NOT be passed as an environment variable. The runtime SHALL NOT read the live process environment.

#### Scenario: Non-Windows child receives PATH and mapped variables only

- **GIVEN** a parent environment that contains `PATH`, `SYSTEMROOT`, `TEMP`, `TMP`, `PATHEXT`, `HOME`, `USERPROFILE`, `ENCRYPTION_KEY`, and `MCP_HOST`
- **AND** a descriptor that maps one account field to the variable `TOKEN` with a known value
- **AND** the platform supplied to the runtime is not Windows
- **WHEN** the test calls the environment-report tool
- **THEN** the reported environment contains `PATH` with the same value as the supplied parent environment
- **AND** the reported environment contains `TOKEN` with that known value
- **AND** the reported environment does not contain `SYSTEMROOT`, `TEMP`, `TMP`, `PATHEXT`, `HOME`, `USERPROFILE`, `ENCRYPTION_KEY`, or `MCP_HOST`

#### Scenario: Windows child also receives SYSTEMROOT

- **GIVEN** the same parent environment and the same `TOKEN` mapping
- **AND** the platform supplied to the runtime is Windows
- **WHEN** the test calls the environment-report tool
- **THEN** the reported environment contains `PATH` and `SYSTEMROOT` with the same values as the supplied parent environment
- **AND** the reported environment contains `TOKEN` with that known value
- **AND** the reported environment does not contain `TEMP`, `TMP`, `PATHEXT`, `HOME`, `USERPROFILE`, `ENCRYPTION_KEY`, or `MCP_HOST`

### Requirement: Production registry still rejects proxy

Building the connector registry SHALL still fail for a module with `kind` `proxy`, and that failure SHALL NOT start a child process. The production registry SHALL still include the Gmail connector and SHALL NOT include a proxy connector. This change SHALL NOT add proxy tools to the MCP port tool list.

#### Scenario: Proxy kind fails registry build and starts no child

- **GIVEN** a connector module with `kind` `proxy` and an otherwise complete description
- **WHEN** the registry is built with that module
- **THEN** registry build fails
- **AND** the launch count stays 0

#### Scenario: Production registry includes Gmail and no proxy connector

- **GIVEN** the production connector registry
- **WHEN** its public connector list is read
- **THEN** the list includes a connector with `id` `gmail`
- **AND** no listed connector has `kind` `proxy`
