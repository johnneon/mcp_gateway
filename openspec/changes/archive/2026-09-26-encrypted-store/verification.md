# encrypted-store

## Result
blockers: 0

## Spec
- Project state directory and gitignore: met
- State file path and format: met
- A missing file yields an empty state and does not create the file: met
- Replace keeps the document for a later open: met
- Ciphertext does not contain the document plaintext: met
- Overlapping replace calls are serialized: met
- A wrong key and a corrupt file are rejected without a leak: met
- Store programmatic API: met
- ENCRYPTION_KEY is base64 of exactly 32 bytes: met
- Startup with a valid or missing state file: met
- A store failure does not open the ports: met
- Two HTTP listeners with a complete environment (modified): met

## Checks
- tests: passed — 40 server + 2 web Vitest tests
- type check: passed
- lint: passed
- format check: passed
- build: passed

## Review
- note: design decision 3 wording says a version-byte change without re-encrypt yields tag failure (`cannot be decrypted`); implementation and the delta (and design risks) check version ≠ 1 before decrypt and return `state file is corrupt` — matches the accepted spec
- note: Windows `rename` over an existing `state.bin` uses unlink-then-rename (`store.ts`); design acknowledges non-atomic replace on this OS
- note: `main.ts` opens the store before listen and does not retain the handle afterward — correct for this change (no domain consumers yet)

## E2E
- No state.bin — the process listens: passed — both listeners accepted TCP; `state.bin` absent after start; key absent from stdout/stderr
- Valid state.bin — the process listens: passed — both listeners accepted TCP; key and canary absent from output
- Wrong key — ports stay closed: passed — exit 1; ports closed; stderr `state file cannot be decrypted`; no key or canary leak
- Corrupt file — ports stay closed: passed — exit 1; ports closed; stderr `state file is corrupt`; no key leak
- Admin UI (Playwright): not exercised — this change adds no admin screens
- MCP tools/client: not exercised — this change adds no MCP tools; store loads before listen only

Evidence: `openspec/changes/encrypted-store/e2e/startup-scenarios.json`

## Leaks
- store error messages (`state file is corrupt` / `state file cannot be decrypted`): clean
- env parse errors (stderr name `ENCRYPTION_KEY` only): clean
- process-startup stdout/stderr on success and store failure: clean
- e2e startup outputs for missing/valid/wrong-key/corrupt: clean
- on-disk `state.bin` canary plaintext (unit + design): clean — ciphertext does not contain canary
