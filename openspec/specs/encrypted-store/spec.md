# encrypted-store Specification

## Purpose

Defines the single encrypted state store: one file under `DATA_DIR` (for a running process, the project `data` directory), loaded into memory at startup, rewritten atomically through a queue, and rejected without leaking the key or the file contents.

## Requirements

### Requirement: Project state directory and gitignore

For a running gateway the state directory SHALL be the project directory `data` at the repository root (next to `server/` and `web/`). `DATA_DIR` SHALL stay required; for a running process it SHALL point at that `data` directory. The state file SHALL be `state.bin` inside `DATA_DIR`; the write temp file SHALL be `state.bin.tmp` in the same directory. The root `.gitignore` SHALL contain the line `data/`, so `state.bin` and the temp file are not committed; a second ignore pattern for the same directory SHALL NOT be added. Automated tests MAY set `DATA_DIR` to a subdirectory inside `data/` so they do not overwrite a local `data/state.bin`.

#### Scenario: State file path is the project data directory

- **GIVEN** a running gateway whose `DATA_DIR` points at the project `data` directory
- **WHEN** the store has successfully written a document
- **THEN** the file exists at `data/state.bin` relative to the repository root

#### Scenario: data/ is in .gitignore

- **GIVEN** the repository root `.gitignore`
- **WHEN** the data-directory entry is checked
- **THEN** the file contains the line `data/`

### Requirement: State file path and format

Gateway state SHALL be stored in one file, `state.bin`, inside `DATA_DIR`. On disk the file SHALL be encrypted with AES-256-GCM using the key from the environment. Byte 0 of the file SHALL be format version `1`; bytes 1–12 SHALL be the IV; the ciphertext SHALL follow, then a 16-byte authentication tag. The version byte SHALL be additional authenticated data, so changing the version without re-encrypting SHALL fail the tag check.

#### Scenario: The file is at the agreed path

- **GIVEN** `DATA_DIR` exists and the store has already written a document
- **WHEN** the test checks the state file path
- **THEN** the file exists at `DATA_DIR/state.bin`

### Requirement: A missing file yields an empty state and does not create the file

If `DATA_DIR/state.bin` does not exist, opening the store SHALL set the in-memory document to the empty JSON object `{}` and SHALL NOT create `state.bin` until the first successful `replace`.

#### Scenario: No file — memory is {} and the file is not created

- **GIVEN** `DATA_DIR` exists and contains no `state.bin`
- **WHEN** the store opens with a valid key
- **THEN** the in-memory document equals `{}`
- **AND** `DATA_DIR/state.bin` is still absent

### Requirement: Replace keeps the document for a later open

`replace` SHALL replace the in-memory document and the on-disk document in full. After a successful `replace`, opening the same file again with the same key SHALL return the same JSON document. The write SHALL go to a temp file in the same directory, then an atomic rename to `state.bin`; if the write fails, the in-memory document SHALL stay as it was.

#### Scenario: Write and reopen with the same key

- **GIVEN** the store is open with no file or with an empty document, and the test knows the key
- **WHEN** `replace` runs with a JSON object document, then the store opens again with the same key from the same `DATA_DIR`
- **THEN** the document read back deep-equals the document that was written

### Requirement: Ciphertext does not contain the document plaintext

After a successful `replace`, the bytes of `state.bin` SHALL NOT contain a recognizable plaintext canary string that is present in the saved JSON document.

#### Scenario: Canary is absent from the file bytes

- **GIVEN** the store is open with a valid key
- **WHEN** `replace` runs with a document that contains a unique plaintext canary string known to the test
- **THEN** the contents of `DATA_DIR/state.bin` as a byte sequence do not contain that canary string in the clear

### Requirement: Overlapping replace calls are serialized

In one process, overlapping `replace` calls SHALL finish without corrupting the file: both calls SHALL finish successfully or with an explicit write error, and the resulting `state.bin` SHALL decrypt with the same key into a valid JSON object. A cross-process file lock is not required by this requirement.

#### Scenario: Two overlapping replace calls do not corrupt the file

- **GIVEN** the store is open with a valid key
- **WHEN** two `replace` calls with different documents are started so that their execution overlaps
- **THEN** both calls finish (with success or a write error) without hanging
- **AND** after they finish, `state.bin` decrypts with the same key into a JSON object
- **AND** the in-memory document matches the last successfully written value under the queue rules

### Requirement: A wrong key and a corrupt file are rejected without a leak

If `state.bin` exists but the authentication tag does not match (wrong key or tampered ciphertext), open SHALL fail with the fixed English text `state file cannot be decrypted`. If the file is shorter than the header, the version byte is not `1`, or the decrypted bytes are not a JSON object, open SHALL fail with the fixed English text `state file is corrupt`. The error text and the process output SHALL NOT contain the key value and SHALL NOT contain the file's bytes or plaintext.

#### Scenario: Wrong key — cannot be decrypted

- **GIVEN** `state.bin` was written with one valid key, and open uses a different valid 32-byte key; the test knows both key values and a canary from the document
- **WHEN** the store opens with the second key
- **THEN** the operation fails
- **AND** the error text equals `state file cannot be decrypted`
- **AND** the error text contains neither key value and does not contain the canary from the document

#### Scenario: Truncated or damaged file — corrupt

- **GIVEN** `DATA_DIR` contains a `state.bin` that is shorter than the header or otherwise damaged so that it fails format or JSON checks (not an auth-tag failure); the test knows the key value and the original contents, if any
- **WHEN** the store opens with a valid key
- **THEN** the operation fails
- **AND** the error text equals `state file is corrupt`
- **AND** the error text does not contain the key value and does not contain the original file contents

### Requirement: Store programmatic API

The store SHALL let later stages open the file (`open`), read the current in-memory document, and replace the document in full (`replace`). The API of this change SHALL NOT include configurations, accounts, HTTP routes, or UI.

#### Scenario: Open, read, and replace are available without a domain model

- **GIVEN** a valid key and a `DATA_DIR` directory
- **WHEN** `open`, a document read, and `replace` of an arbitrary JSON object are called
- **THEN** the operations run without calling the configurations API, accounts API, HTTP, or UI
