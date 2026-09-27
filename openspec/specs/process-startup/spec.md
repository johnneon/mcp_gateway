# process-startup Specification

## Purpose

Defines startup of the single Node process: environment checks that do not leak values, and two HTTP listeners (MCP and admin), including serving the production build of the UI.

## Requirements

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

### Requirement: ENCRYPTION_KEY is base64 of exactly 32 bytes

When parsing the environment, the process SHALL accept `ENCRYPTION_KEY` only as standard base64 that decodes to exactly 32 bytes (an AES-256 key). If the string is missing, empty, uses an alphabet outside standard base64, or decodes to a length other than 32, the process SHALL exit with status 1 and SHALL write the name `ENCRYPTION_KEY` to stderr without the value. A successful parse SHALL pass on the 32-byte key, not the original environment string. Existing startup tests that used to place an arbitrary plaintext string in `ENCRYPTION_KEY` SHALL use a valid 32-byte base64 key; the leak check SHALL still assert that the key value (the environment string) is absent from stdout and stderr.

#### Scenario: Wrong length after base64 — the name ENCRYPTION_KEY

- **GIVEN** every required variable is set, and `ENCRYPTION_KEY` is valid base64 that does not decode to 32 bytes; the test knows that string
- **WHEN** the process starts (or environment parsing is invoked under the same startup-error contract)
- **THEN** the exit code is non-zero (or parsing fails startup)
- **AND** stderr (or the startup error channel) contains the string `ENCRYPTION_KEY`
- **AND** stderr and stdout do not contain the supplied `ENCRYPTION_KEY` value

#### Scenario: Invalid base64 — the name ENCRYPTION_KEY

- **GIVEN** every required variable is set, and `ENCRYPTION_KEY` contains characters outside standard base64; the test knows that value
- **WHEN** the process starts (or environment parsing is invoked under the same contract)
- **THEN** the exit code is non-zero (or parsing fails startup)
- **AND** stderr (or the startup error channel) contains the string `ENCRYPTION_KEY`
- **AND** stderr and stdout do not contain the supplied `ENCRYPTION_KEY` value

#### Scenario: Startup fixtures use a valid key and do not leak it

- **GIVEN** a successful-start scenario, or a missing-variable check from `process-startup`, supplies `ENCRYPTION_KEY` as valid base64 of exactly 32 bytes after decoding
- **WHEN** the process runs that scenario
- **THEN** that `ENCRYPTION_KEY` string is absent from stdout and stderr

### Requirement: Startup with a valid or missing state file

If the required variables are valid and `DATA_DIR/state.bin` is missing or decrypts with the current key into a JSON object, the process SHALL finish loading the store and SHALL open both HTTP listeners as in the two-listener requirement. `DATA_DIR` SHALL stay required; for a running gateway it points at the project `data` directory, and automated tests MAY use a subdirectory inside `data/`.

#### Scenario: No state.bin — the process listens

- **GIVEN** the required variables are valid, including a valid `ENCRYPTION_KEY`, the `DATA_DIR` directory exists, and it has no `state.bin`
- **WHEN** the process starts
- **THEN** both TCP listeners accept a connection
- **AND** `state.bin` is not created merely because the process started

#### Scenario: Valid state.bin — the process listens

- **GIVEN** the required variables are valid and `DATA_DIR` contains a `state.bin` written with the same key and a JSON object
- **WHEN** the process starts
- **THEN** both TCP listeners accept a connection

### Requirement: A store failure does not open the ports

If opening the store at startup fails because of a wrong key or a corrupt file (the texts `state file cannot be decrypted` or `state file is corrupt`), the process SHALL exit with status 1 before opening the HTTP listeners. stdout and stderr SHALL NOT contain the `ENCRYPTION_KEY` value and SHALL NOT contain the state file contents.

#### Scenario: Wrong key — ports stay closed

- **GIVEN** `DATA_DIR` contains a `state.bin` from another key; the current `ENCRYPTION_KEY` is valid in format and known to the test; a canary from the document is known to the test
- **WHEN** the process starts
- **THEN** the exit code is 1
- **AND** neither `MCP_PORT` nor `ADMIN_PORT` accepts a TCP connection
- **AND** stdout and stderr contain `state file cannot be decrypted` and do not contain the key value or the canary

#### Scenario: Corrupt file — ports stay closed

- **GIVEN** `DATA_DIR` contains a truncated or otherwise corrupt `state.bin` (a format or JSON error, not an auth-tag failure); `ENCRYPTION_KEY` is valid and known to the test
- **WHEN** the process starts
- **THEN** the exit code is 1
- **AND** neither `MCP_PORT` nor `ADMIN_PORT` accepts a TCP connection
- **AND** stdout and stderr contain `state file is corrupt` and do not contain the key value or the file's bytes or plaintext

### Requirement: Two HTTP listeners with a complete environment

When the required variables are set (and `ADMIN_HOST` when needed) and the encrypted store has loaded, the process SHALL open two TCP listeners: one on `MCP_HOST`:`MCP_PORT`, the other on the effective admin host and `ADMIN_PORT`. Both SHALL accept an incoming TCP connection. The values of `DATA_DIR` and `ENCRYPTION_KEY` SHALL NOT appear in stdout or stderr on a successful start.

#### Scenario: Both listeners accept a connection

- **GIVEN** `MCP_HOST`, `MCP_PORT`, `ADMIN_HOST`, `ADMIN_PORT`, `DATA_DIR`, and a valid base64 `ENCRYPTION_KEY` (exactly 32 bytes after decoding) are set, with loopback test addresses and free ports; the state file is missing or valid for this key
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
