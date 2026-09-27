# Tasks

## 1. ENCRYPTION_KEY format in env

- [x] 1.1 Change `parseEnv` / `EnvConfig`: `ENCRYPTION_KEY` is standard base64 of exactly 32 bytes → `Buffer`; a bad alphabet or length is a refusal with the name `ENCRYPTION_KEY` and no value. Update fixtures in `env.test.ts` and related tests to a valid key; add scenarios for the wrong length and invalid base64; keep the check that the key value is absent from the error text. Check: the env tests pass; `npm run typecheck` in the affected package passes.

## 2. Encrypted store module

- [x] 2.1 Implement the codec and `open`: path `DATA_DIR/state.bin` (for a running gateway `DATA_DIR` is the project `data` directory), layout version/IV/ciphertext/tag with AAD on the version, empty state `{}` without creating a file, errors `state file is corrupt` and `state file cannot be decrypted` with no key and no contents. Automated tests: no file → `{}` and the file is not created; wrong key → decrypt text; truncated/corrupt → corrupt text; no leak of the key/canary; the test `DATA_DIR` is a subdirectory inside `data/`. Check: the new store tests pass.

- [x] 2.2 Implement `replace` with a queue: temp `state.bin.tmp`, fsync, rename, then swap the in-memory document; a failure leaves the previous document. Automated tests: write + reopen with the same key → the same document; the canary is not in the file bytes; two overlapping replace calls finish and the file decrypts. Check: the store tests pass; `npm test` for server on these files exits 0.

- [x] 2.3 Check that the root `.gitignore` already contains the line `data/` (it is already there). Do not add a second pattern and do not introduce another directory name instead of `data`. Check: `.gitignore` contains `data/`; product code does not edit `.gitignore` if the line is present.

## 3. Process startup and process-startup

- [x] 3.1 In `main.ts`: after `parseEnv`, open the store before `listen`; on a store error, write the fixed English text to stderr, exit 1, and do not open ports. Update `process-startup` spawn fixtures to a valid base64 key; test `DATA_DIR` is a subdirectory of `data/`; add scenarios: no file — listens and does not create `state.bin`; valid file — listens; wrong key / corrupt file — exit 1, ports closed, no leak of the key or the contents. Check: the process-startup and store tests pass.

## 4. Full package check

- [x] 4.1 From the root: `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build` exit 0. Test names cover the `encrypted-store` delta scenarios (including the `data` directory and gitignore) and the added or changed `process-startup` scenarios. Check: every command exits 0.
