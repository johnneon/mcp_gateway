# connector-gmail

## Result
blockers: 0

## Spec
- Gmail connector module identity and fields: met
- Gmail connection check uses IMAP LOGIN and SMTP AUTH over egress: met
- Gmail list_messages tool: met
- Gmail search_messages tool: met
- Gmail read_message tool: met
- Shared mail protocol is separate from the Gmail connector: met
- Password never appears in Gmail tool or admin surfaces: met
- Production registry includes registered product connectors: met
- Native connector module shape (checkConnection receives egress): met
- Allowed destinations as host and port pairs: met
- Native connector tools (handler and checkConnection both receive egress): met
- MCP app accepts an injectable connector registry: met
- TLS session operation returns an open duplex: met
- Resolve allowed destinations for an account: met
- HTTPS request and TLS connect operations (handshake distinct from session): met
- Create account after connection check (egress passed): met
- Patch account with secret keep semantics (egress on recheck): met
- Check connection without write (egress passed): met
- Accounts API follows admin JSON and CORS rules: met

## Checks
- tests: passed — 216 server + 45 web (261 total)
- type check: passed
- lint: passed
- format check: passed
- build: passed

## Review
- note: `server/test/http/mcp-endpoint.test.ts` keeps the scenario title `Handler receives egress client; checkConnection does not` while asserting both receive egress (matches the modified delta).
- note: `server/test/connectors/registry.test.ts` keeps the title `Production registry stays empty` while asserting production includes `gmail` (matches the modified delta).
- note: browser console shows `favicon.ico` 404 on admin; unrelated to this delta (same as prior admin UI verification). Failed create also logs the expected HTTP 400 for `POST /api/accounts` in the browser console.
- note: no edits to `mcp-gateway-spec.md` or `openspec/specs/` on this branch; production registry registers only Gmail; fakes stay in tests and throwaway e2e harnesses.

## E2E
- Production registry lists Gmail with Address and App password fields: passed — admin Connectors showed `Gmail`; Add account dialog fields `Address` and `App password` (`e2e/admin-gmail-account-created.png`)
- Successful check when fake IMAP and SMTP both accept login: passed — UI create persisted `Personal inbox` with `address: user@gmail.com`; `POST /api/accounts` 201; Check connection `POST .../check` 200; fixture password absent from DOM after dialog dismissed
- Failed check when fake IMAP rejects login: passed — dialog alert `Connection check failed`; account list stayed `No accounts yet.`; fixture password absent from DOM after Cancel (`e2e/admin-gmail-connection-check-failed.png`); API path also covered by `e2e/mcp-gmail-client.mjs`
- Failed check when fake SMTP rejects AUTH: passed — `e2e/mcp-gmail-client.mjs` returned 400 body exactly `Connection check failed`, no save, password absent
- List returns capped summaries without bodies on a fake IMAP server: passed — `gmail_list_messages` returned 50 summaries without bodies; password absent
- Narrow filter search returns matching summaries on a fake IMAP server: passed — `gmail_search_messages` with `{ from: "alice@example.test" }` matched only alice; password absent
- Free-form IMAP search syntax is rejected: passed — free-form filter rejected without opening an IMAP TLS session; password absent from error
- Read returns headers and text body without attachment bytes: passed — `gmail_read_message` uid 42 returned headers and text; attachment bytes and password absent
- Shared module authenticates over a duplex without opening its own TCP socket: passed — covered by unit tests and fake duplex e2e path (no live host)
- Fixture password absent from tool result and MCP error: passed — list success and tool/error paths in `e2e/mcp-gmail-client.mjs` and automated tests
- Empty and unknown bearer identical rejection: passed — both 401 Unauthorized with identical body
- MCP vs admin port separation: passed — admin `/mcp` 404; MCP `/api/connectors` 404
- tools/list exposes Gmail MCP names: passed — `gmail_list_messages`, `gmail_search_messages`, `gmail_read_message`

## Leaks
- admin UI DOM after successful create (dialog dismissed): clean
- admin UI DOM after failed create (dialog dismissed): clean
- admin API create/check responses (e2e client + UI network): clean — fixed `Connection check failed` on failure; success bodies without fixture password
- MCP tools/list and tools/call results: clean
- MCP error text (free-form search rejection): clean
- browser console (aside from favicon 404 and expected 400 on failed create): clean
