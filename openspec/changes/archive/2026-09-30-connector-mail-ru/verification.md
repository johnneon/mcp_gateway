# connector-mail-ru

## Result
blockers: 0

## Spec
- Mail.ru connector module identity and fields: met
- Mail.ru connection check uses IMAP LOGIN and SMTP AUTH over egress: met
- Mail.ru list_messages tool: met
- Mail.ru search_messages tool: met
- Mail.ru read_message tool: met
- Mail.ru uses the shared mail protocol module: met
- Password never appears in Mail.ru tool or admin surfaces: met
- Shared mail protocol is separate from the Gmail connector: met
- Production registry includes registered product connectors: met

## Checks
- tests: passed — 258 server + 45 web (303 total)
- type check: passed
- lint: passed
- format check: passed
- build: passed

## Review
- note: browser console shows `favicon.ico` 404 on admin; unrelated to this delta. Failed create also logs the expected HTTP 400 for `POST /api/accounts`.
- note: no edits to `mcp-gateway-spec.md` or `openspec/specs/` on this branch. Production registry registers `gmail` and `mailru`. Fakes stay in tests and the throwaway e2e harness. The connector does not open TCP or TLS outside `egressClient.tlsSession`, and SMTP is AUTH only.

## E2E
- Production registry lists Mail.ru with Address and App password fields: passed — admin Connectors showed `Mail.ru` and `Gmail`; Add account dialog for Mail.ru had `Address` and `App password` (`e2e/admin-mailru-connection-check-failed.png`)
- Mail.ru allowlist is the two constant hosts: passed — unit tests assert exactly `imap.mail.ru:993` and `smtp.mail.ru:465`; e2e used that fake egress and did not contact a live host
- Successful check when fake IMAP and SMTP both accept login: passed — UI create persisted `Personal inbox` with `address: user@mail.ru`; `POST /api/accounts` 201; Check connection `POST .../check` 200; fixture password absent from the DOM after the dialog closed
- Failed check when fake IMAP rejects login: passed — dialog alert `Connection check failed`; Mail.ru stayed `No accounts yet.`; fixture password absent from the DOM after Cancel (`e2e/admin-mailru-connection-check-failed.png`); API body was exactly `Connection check failed`
- Failed check when fake SMTP rejects AUTH: passed — `e2e/mcp-client.mjs` returned 400 body exactly `Connection check failed`, no save, password absent
- List returns capped summaries without bodies on a fake IMAP server: passed — `mailru_list_messages` returned 50 summaries without bodies; password absent
- Narrow filter search returns matching summaries on a fake IMAP server: passed — `mailru_search_messages` with `{ from: "alice@example.test" }` matched only alice; password absent
- Free-form IMAP search syntax is rejected: passed — free-form filter and unknown filter key rejected without a new IMAP TLS session; password absent from the error
- Read returns headers and text body without attachment bytes: passed — `mailru_read_message` uid 42 returned headers and text; attachment bytes and password absent
- Mail.ru login uses the shared module over the egress duplex: passed — covered by unit tests and the fake duplex e2e path (no live host)
- Fixture password absent from tool result and MCP error: passed — list success and a handler throw that included the fixture secret; MCP error text omitted the secret (`e2e/mcp-client.mjs`)
- Shared module authenticates over a duplex without opening its own TCP socket: passed — existing shared-module test; Mail.ru e2e used the same fake duplexes
- Production export includes Mail.ru alongside Gmail: passed — `GET /api/connectors` listed `mailru` and `gmail`
- Empty and unknown bearer identical rejection: passed — both 401 with identical body
- MCP vs admin port separation: passed — admin `/mcp` 404; MCP `/api/connectors` 404
- tools/list exposes Mail.ru MCP names: passed — `mailru_list_messages`, `mailru_search_messages`, `mailru_read_message`; password and host absent
- Foreign and disabled account: passed — `mailru_list_messages` rejected both; fake TLS session count stayed 0

## Leaks
- admin UI DOM after successful create (dialog dismissed): clean
- admin UI DOM after failed create (dialog dismissed): clean
- admin API create, list, patch, and check responses: clean — fixed `Connection check failed` on failure; success bodies without the fixture password
- MCP tools/list and tools/call results: clean
- MCP error text (free-form search rejection and secret-bearing handler throw): clean
- browser console (aside from favicon 404 and expected 400 on failed create): clean
