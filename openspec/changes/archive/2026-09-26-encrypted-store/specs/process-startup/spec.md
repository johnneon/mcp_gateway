# Spec Delta

## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Two HTTP listeners with a complete environment

When the required variables are set (and `ADMIN_HOST` when needed) and the encrypted store has loaded, the process SHALL open two TCP listeners: one on `MCP_HOST`:`MCP_PORT`, the other on the effective admin host and `ADMIN_PORT`. Both SHALL accept an incoming TCP connection. The values of `DATA_DIR` and `ENCRYPTION_KEY` SHALL NOT appear in stdout or stderr on a successful start.

#### Scenario: Both listeners accept a connection

- **GIVEN** `MCP_HOST`, `MCP_PORT`, `ADMIN_HOST`, `ADMIN_PORT`, `DATA_DIR`, and a valid base64 `ENCRYPTION_KEY` (exactly 32 bytes after decoding) are set, with loopback test addresses and free ports; the state file is missing or valid for this key
- **WHEN** the process starts
- **THEN** a TCP client connects to `MCP_HOST`:`MCP_PORT`
- **AND** a TCP client connects to `ADMIN_HOST`:`ADMIN_PORT`
- **AND** stdout and stderr do not contain the `ENCRYPTION_KEY` or `DATA_DIR` values
