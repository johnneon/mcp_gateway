# Spec Delta

## Purpose

Defines startup of the single Node process: environment checks that do not leak values, and two HTTP listeners (MCP and admin), including serving the production build of the UI.

## ADDED Requirements

### Requirement: Required environment variables at startup

The process SHALL require `MCP_HOST`, `MCP_PORT`, `ADMIN_PORT`, `DATA_DIR`, and `ENCRYPTION_KEY` at startup. If any one of them is missing or empty, the process SHALL exit with a non-zero status and SHALL write the missing variable's name to stdout or stderr. The message SHALL NOT contain the value of any environment variable, including `ENCRYPTION_KEY` or any other secret sample from the test environment.

#### Scenario: Missing MCP_HOST

- **GIVEN** every required variable is set except `MCP_HOST`
- **WHEN** the process starts
- **THEN** the exit code is non-zero
- **AND** stdout or stderr contains the string `MCP_HOST`
- **AND** stdout and stderr do not contain the values of the other variables that were set

#### Scenario: Missing MCP_PORT

- **GIVEN** every required variable is set except `MCP_PORT`
- **WHEN** the process starts
- **THEN** the exit code is non-zero
- **AND** stdout or stderr contains the string `MCP_PORT`
- **AND** stdout and stderr do not contain the values of the other variables that were set

#### Scenario: Missing ADMIN_PORT

- **GIVEN** every required variable is set except `ADMIN_PORT`
- **WHEN** the process starts
- **THEN** the exit code is non-zero
- **AND** stdout or stderr contains the string `ADMIN_PORT`
- **AND** stdout and stderr do not contain the values of the other variables that were set

#### Scenario: Missing DATA_DIR

- **GIVEN** every required variable is set except `DATA_DIR`
- **WHEN** the process starts
- **THEN** the exit code is non-zero
- **AND** stdout or stderr contains the string `DATA_DIR`
- **AND** stdout and stderr do not contain the values of the other variables that were set

#### Scenario: Missing ENCRYPTION_KEY

- **GIVEN** every required variable is set and a sample `ENCRYPTION_KEY` value is known to the test, but `ENCRYPTION_KEY` itself is unset
- **WHEN** the process starts
- **THEN** the exit code is non-zero
- **AND** stdout or stderr contains the string `ENCRYPTION_KEY`
- **AND** stdout and stderr do not contain the secret sample used in the other scenarios of this requirement

### Requirement: ADMIN_HOST defaults to 127.0.0.1

If `ADMIN_HOST` is missing or empty, the process SHALL treat it as `127.0.0.1` and SHALL NOT exit because `ADMIN_HOST` is absent. If `ADMIN_HOST` is set to a non-empty value, the process SHALL listen for the UI on that address.

#### Scenario: ADMIN_HOST is unset

- **GIVEN** `MCP_HOST`, `MCP_PORT`, `ADMIN_PORT`, `DATA_DIR`, and `ENCRYPTION_KEY` are set, and `ADMIN_HOST` is unset
- **WHEN** the process starts
- **THEN** the exit code is zero (the process stays up)
- **AND** the admin listener accepts a connection on `127.0.0.1` and the port from `ADMIN_PORT`

#### Scenario: ADMIN_HOST is set explicitly

- **GIVEN** every variable is set, including a non-empty `ADMIN_HOST` (for example `127.0.0.1`)
- **WHEN** the process starts
- **THEN** the admin listener accepts a connection on the host from `ADMIN_HOST` and the port from `ADMIN_PORT`

### Requirement: Two HTTP listeners with a complete environment

When the required variables are set (and `ADMIN_HOST` when needed), the process SHALL open two TCP listeners: one on `MCP_HOST`:`MCP_PORT`, the other on the effective admin host and `ADMIN_PORT`. Both SHALL accept an incoming TCP connection. `DATA_DIR` and `ENCRYPTION_KEY` SHALL be accepted at startup even if the store is not implemented yet; their values SHALL NOT appear in stdout or stderr on a successful start.

#### Scenario: Both listeners accept a connection

- **GIVEN** `MCP_HOST`, `MCP_PORT`, `ADMIN_HOST`, `ADMIN_PORT`, `DATA_DIR`, and `ENCRYPTION_KEY` are set, with loopback test addresses and free ports
- **WHEN** the process starts
- **THEN** a TCP client connects to `MCP_HOST`:`MCP_PORT`
- **AND** a TCP client connects to `ADMIN_HOST`:`ADMIN_PORT`
- **AND** stdout and stderr do not contain the `ENCRYPTION_KEY` or `DATA_DIR` values

### Requirement: Admin serves the web production build

The admin listener SHALL serve the static production build of the `web` package so that HTTP GET of the root path returns a successful response with the shell application's HTML. The shell SHALL be in English. The Configurations and Connectors screens are not required in this change.

#### Scenario: Admin root returns the shell HTML

- **GIVEN** the process is running with the full set of variables and a built `web` package
- **WHEN** the client performs HTTP GET `/` on the admin host and `ADMIN_PORT`
- **THEN** the response status is successful
- **AND** the response body contains the admin UI shell HTML
