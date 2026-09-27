# Design

## Context

See `proposal.md` — Why. The `project-skeleton` frame already parses the environment (`server/src/env.ts`) and listens on two ports (`server/src/main.ts`) without opening a store: `EnvConfig.encryptionKey` is a string, and `DATA_DIR` is only stored. Vision: `mcp-gateway-spec.md` ("Store", "Environment"). The current startup contract: `openspec/specs/process-startup/spec.md`. The `project-skeleton` dependency is archived.

## Goals / Non-Goals

**Goals:**

- One encrypted state file, loaded before `listen`.
- The key format and the file layout are fixed and checked by automated tests.
- The data directory is the project `data`; `DATA_DIR` is required; `data/` is in `.gitignore`.
- An `open` / read / `replace` API for later stages, with no domain model.
- Errors in English, fixed text, with no key and no file contents.

**Non-Goals:**

- Configurations, accounts, bearer hashes, and HTTP/UI/MCP on top of the store.
- A file lock across processes, key rotation, and migration from plaintext.
- Creating `DATA_DIR` if the directory is missing (the operator supplies an existing directory; a missing directory does not extend this change's contract beyond Node's errors on write).

## Decisions

Accepted by the person before propose; they are not reopened here.

### 1. ENCRYPTION_KEY format

`ENCRYPTION_KEY` is standard base64 that decodes to exactly 32 bytes (AES-256). The check is in `parseEnv`. A bad alphabet or a length other than 32: `process.exit(1)`, and stderr contains only the name `ENCRYPTION_KEY`, with no value. `EnvConfig.encryptionKey` is a `Buffer` of length 32, not the original string.

**Alternative (rejected):** hex or a raw string of arbitrary length — worse for AES-256 and for an explicit size check.

### 2. File path

`path.join(DATA_DIR, 'state.bin')`. `DATA_DIR` stays a required environment variable and is not removed from the startup contract. For a running gateway `DATA_DIR` points at the project `data` directory at the repository root (next to `server/` and `web/`), so the file is `data/state.bin`. The write temp file is `data/state.bin.tmp` in the same directory (`path.join(DATA_DIR, 'state.bin.tmp')`). Automated tests MAY set `DATA_DIR` to a subdirectory inside `data/` so they stay under gitignore and do not overwrite a local `data/state.bin`.

### 3. On-disk layout

| Offset | Contents |
| --- | --- |
| 0 | version `1` (1 byte) |
| 1–12 | a fresh 12-byte IV on every write |
| 13 … n-17 | AES-256-GCM ciphertext |
| last 16 | auth tag |

The version byte is additional authenticated data: changing the version without re-encrypting fails the tag (`state file cannot be decrypted`), rather than silently changing the format.

Implementation: Node.js `crypto` (`createCipheriv` / `createDecipheriv` with `aes-256-gcm`).

### 4. In-memory document and when the file appears

The document is a JSON object. The empty state is `{}`. Startup with no file does not create `state.bin`. The file appears on the first successful `replace`.

### 5. Write and queue

In one process, writes are serialized by a queue (a promise chain / in-memory mutex). `replace`:

1. Writes `DATA_DIR/state.bin.tmp` in the same directory.
2. `fsync`s the temp file.
3. `rename`s it to `state.bin`.
4. Swaps the in-memory document only after a successful rename.

A failed write leaves the previous document in memory. There is no cross-process file lock.

### 6. Error texts (English, fixed)

| Condition | Text | When |
| --- | --- | --- |
| file shorter than the header; version ≠ 1; decrypted bytes are not a JSON object | `state file is corrupt` | before `listen`, exit 1 |
| auth tag failure (wrong key or tampered ciphertext) | `state file cannot be decrypted` | before `listen`, exit 1 |

No key and no file bytes in the message or in stdout/stderr.

### 7. Store API of this change

- `open(dataDir, key)` — load, or the empty state
- read the current document
- `replace(document)` — the whole document

No configurations, accounts, HTTP, or UI.

### 8. Startup integration and tests

`main.ts`: `parseEnv` → `open` the store → on a store error write the fixed text to stderr and `exit(1)` → otherwise `listen`. `ENCRYPTION_KEY` fixtures in the existing process-startup tests become valid 32-byte base64; the assert "the key value is not in stdout/stderr" stays. The test `DATA_DIR` is a subdirectory of the project `data/`, not the operator's root `data/state.bin`.

**Structure (guide):**

```text
data/                 DATA_DIR of a running gateway; gitignored as data/
  state.bin
  state.bin.tmp
server/src/
  env.ts              encryptionKey: Buffer; validate base64/length
  store/
    open.ts / store.ts  open, read, replace, queue, codec
  main.ts             parseEnv → open store → listen
server/test/
  env.test.ts         update the key; bad-format scenarios
  process-startup.*   valid key; store failure with no ports
  store*.test.ts      encrypted-store scenarios
```

### 9. Directory name and gitignore

The data directory in the repository is named `data` (not another name). The root `.gitignore` already contains the line `data/` — apply checks that it is present and does not add a second pattern. Because of that, `state.bin` and `state.bin.tmp` are never committed.

## Risks / Trade-offs

- [No cross-process lock] → Mitigation: one gateway process in the product model; recorded in non-goals.
- [A version in AAD yields a decrypt error when version≠1 on a whole file with a foreign layout] → Mitigation: a separate length/version check before decrypt where the format is clearly not `1` or the file is too short → `corrupt`; tag failure stays `cannot be decrypted`.
- [Changing the `encryptionKey` type breaks current tests] → Mitigation: the `process-startup` delta explicitly requires new fixtures; one task updates env and spawn tests.
- [rename on Windows] → Mitigation: the temp file is in the same directory; if needed, replace an existing `state.bin` the way Node does on this OS, keeping the meaning "after success, the new document".

## Migration Plan

A pure addition of the store. Rollback is reverting the change's commits. There is no data to migrate: there was no state file before.

## Open Questions

None. Decisions 1–9 are accepted (1–8 before propose; 9 — the `data` directory and the existing gitignore — at revision).
