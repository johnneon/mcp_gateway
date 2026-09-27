# Proposal

Issue: #7

## Why

The process skeleton already requires `DATA_DIR` and `ENCRYPTION_KEY`, but state on disk is not protected yet. Without one encrypted file, configurations and accounts cannot be stored so that the disk has no plaintext and the model never sees secrets.

## What Changes

- An encrypted store module: one file `DATA_DIR/state.bin`, AES-256-GCM, the document kept in memory as JSON.
- The data directory for a running gateway is the project `data` directory at the repository root (next to `server/` and `web/`). `DATA_DIR` stays required and points at that directory; the process still builds the path as `path.join(DATA_DIR, 'state.bin')`. The write temp file is `state.bin.tmp` in the same directory. The root `.gitignore` already has the line `data/`, so `state.bin` and the temp file are not committed; a second pattern is not added. Automated tests may set `DATA_DIR` to a subdirectory inside `data/` so they do not overwrite a local `data/state.bin`.
- At startup the process opens the store before `listen`. No file means an empty state `{}` and no file is created. A wrong key or a corrupt file means exit 1 and a fixed English reason with no key and no contents.
- `ENCRYPTION_KEY` in the environment is standard base64 of exactly 32 bytes after decoding; `EnvConfig` stores a `Buffer`, not the original string. A bad alphabet or length means exit with the name `ENCRYPTION_KEY` on stderr.
- The store API for later stages: `open`, read the document, `replace` the whole document. Writes are serialized by a queue; a write goes through temp + rename.
- **BREAKING** for startup tests: `ENCRYPTION_KEY` fixtures stop being an arbitrary string and become a valid 32-byte base64 key; the leak check still looks for the absence of the key value in stdout/stderr.

## Non-goals

- Configurations, accounts, bearer hashes, the admin API, the admin UI, and MCP tools.
- A cross-process file lock, key rotation, and migration from a plaintext file.
- HTTP routes and screens tied to store data.

## Capabilities

### New Capabilities

- `encrypted-store`: one encrypted state file, load at startup, a queue of atomic `replace` calls, fixed errors with no leak of the key or the contents, and a programmatic API of `open` / read / `replace`.

### Modified Capabilities

- `process-startup`: the format and check of `ENCRYPTION_KEY` (base64 → 32 bytes); loading the store before opening ports; startup scenarios with a valid file, with no file, with a wrong key, and with a corrupt file; updating key fixtures in existing scenarios without weakening the leak check.

## Impact

- `server/src/env.ts`: `encryptionKey` becomes a `Buffer`; base64 and length are validated while parsing the environment.
- A new store module under `server/src/` (for example `store/`), called from `main.ts` before `listen`.
- The `data/` directory at the repository root as `DATA_DIR` for a running process; a check that `.gitignore` already contains `data/` (no new pattern).
- Tests in `server/test/env.test.ts`, `server/test/process-startup.test.ts`, and new store-scenario tests on Vitest with no external services; the test `DATA_DIR` is a subdirectory of `data/`.
- No runtime dependency beyond Node crypto is required.
