# mailru-connection-check-reason

## Result
blockers: 0

## Spec
- Mail.ru connection check uses IMAP LOGIN over egress: met
- Mail.ru uses the shared mail protocol module: met

## Checks
- tests: passed — 408 server + 51 web (459 total)
- type check: passed
- lint: passed
- format check: passed
- build: passed

## Review
- note: browser console shows `favicon.ico` 404 on admin; unrelated to this delta. Failed create also logs the expected HTTP 400 for `POST /api/accounts`.
- note: no edits to `mcp-gateway-spec.md` or `openspec/specs/` on this branch. Gmail `checkConnection` still runs IMAP LOGIN and SMTP AUTH. Mail.ru keeps `imap.mail.ru:993` and `smtp.mail.ru:465` in the constants and `allowedDestinations`, and `mailruCheckConnection` no longer opens SMTP or imports `createSmtpClient`.

## E2E
- Successful check when fake IMAP accepts LOGIN: passed — admin create of `Inbox` for Mail.ru returned `POST /api/accounts` 201 while fake SMTP would reject AUTH; the account stayed listed with `address: user@mail.ru`; recorded sessions were only `imap.mail.ru:993`; fixture password absent from the DOM after the dialog closed
- Failed check when fake IMAP rejects login: passed — dialog alert `Connection check failed`; response body was exactly `Connection check failed`; the rejected account was not saved; no `smtp.mail.ru:465` session (`e2e/admin-mailru-connection-check-failed.png`); fixture password absent from the DOM after Cancel
- Explicit check succeeds after IMAP LOGIN only: passed — `Check connection` called `POST /api/accounts/:id/check` 200 with body `{"ok":true}`; the stored account stayed on the original fixture password; the new session was `imap.mail.ru:993` and not `smtp.mail.ru:465`; no alert on screen
- Credential patch succeeds after IMAP LOGIN only: passed — `PATCH /api/accounts/:id` 200; response values were only `address`; the store held the new fixture password; the new session was `imap.mail.ru:993` and not `smtp.mail.ru:465`; fixture passwords absent from the DOM after Save
- Mail.ru login uses the shared module over the egress duplex: passed — every recorded harness session was `imap.mail.ru:993`; the unit test still asserts the module imports the shared IMAP client and does not reference `node:net` or `node:tls`
- Empty and unknown bearer identical rejection: passed — both 401 with identical body; fixture password absent
- MCP vs admin port separation: passed — admin `/mcp` 404; MCP `/api/connectors` 404
- tools/list: passed — `mailru_list_messages` listed; fixture password and raw bearer absent
- Foreign and disabled account: passed — `mailru_list_messages` rejected both; fake TLS session count stayed unchanged
- Configuration list after create: passed — raw bearer was not returned again

## Leaks
- admin UI DOM after successful create (dialog dismissed): clean
- admin UI DOM after failed create (dialog dismissed): clean
- admin UI DOM after credential patch (dialog dismissed): clean
- admin API create, list, check, and patch responses: clean — failure body exactly `Connection check failed`; success bodies without the fixture password
- MCP tools/list and rejected tools/call errors: clean
- browser console (aside from favicon 404 and expected 400 on failed create): clean
