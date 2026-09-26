# encrypted-store

## Result
blockers: 0

## Spec
- Каталог состояния в проекте и gitignore: met
- Путь и формат файла состояния: met
- Отсутствие файла даёт пустое состояние без создания файла: met
- Replace сохраняет документ для повторного открытия: met
- Ciphertext не содержит открытый текст документа: met
- Перекрывающиеся replace сериализованы: met
- Чужой ключ и битый файл отвергаются без утечки: met
- Программный API хранилища: met
- ENCRYPTION_KEY — base64 ровно 32 байта: met
- Старт с валидным или отсутствующим файлом состояния: met
- Отказ хранилища не открывает порты: met
- Два HTTP-слушателя при полном окружении (modified): met

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
- Нет state.bin — процесс слушает: passed — both listeners accepted TCP; `state.bin` absent after start; key absent from stdout/stderr
- Валидный state.bin — процесс слушает: passed — both listeners accepted TCP; key and canary absent from output
- Чужой ключ — порты закрыты: passed — exit 1; ports closed; stderr `state file cannot be decrypted`; no key or canary leak
- Битый файл — порты закрыты: passed — exit 1; ports closed; stderr `state file is corrupt`; no key leak
- Admin UI (Playwright): not exercised — this change adds no admin screens
- MCP tools/client: not exercised — this change adds no MCP tools; store loads before listen only

Evidence: `openspec/changes/encrypted-store/e2e/startup-scenarios.json`

## Leaks
- store error messages (`state file is corrupt` / `state file cannot be decrypted`): clean
- env parse errors (stderr name `ENCRYPTION_KEY` only): clean
- process-startup stdout/stderr on success and store failure: clean
- e2e startup outputs for missing/valid/wrong-key/corrupt: clean
- on-disk `state.bin` canary plaintext (unit + design): clean — ciphertext does not contain canary
