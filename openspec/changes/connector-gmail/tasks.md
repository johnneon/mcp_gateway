# Tasks

## 1. Egress TLS session

- [ ] 1.1 Extend the native egress client and injectable transport with a TLS session operation that allowlist-checks before I/O, returns an open duplex, and does not end the socket on establish; keep existing HTTPS and handshake-only `tlsConnect` behavior; same production timeout (30s) and max size (64 MiB), injectable in tests. Unit tests with a fake transport: allowed session invokes transport once and leaves duplex open; disallowed host leaves call count at 0 with `Destination is not allowed`; handshake `tlsConnect` still ends the socket and remains distinct from session. Check: those unit tests pass; `npm run typecheck -w server` exits 0.

## 2. checkConnection receives egress

- [ ] 2.1 Change `CheckConnection` to `(accountValues, egressClient)`; update all in-tree fake connectors and registry/MCP tests to the new signature. Accounts service builds `createEgressClientForAccount` from the connector allowlist and values and passes it on create, patch (when check runs), and explicit check; failures still map to fixed `Connection check failed` without exception text or secrets. Check: connector-contract scenario "Handler receives egress client; checkConnection does not" (updated: both receive egress) and accounts-api scenarios for create/patch/check with egress pass; existing fixed-body failure scenarios still pass.

## 3. Shared mail protocol module

- [ ] 3.1 Add a shared IMAP/SMTP module that speaks only over a provided duplex (no own TCP/TLS socket): IMAP LOGIN, SELECT, SEARCH built from a narrow filter struct (unseen, from, subject substring, since), FETCH for headers and text body; SMTP AUTH only (no send). Optional MIME parse library with no network I/O is allowed for body decode. Unit tests against fake IMAP and fake SMTP duplex servers: LOGIN/AUTH success and failure; SEARCH rejects free-form syntax at the module API; FETCH returns headers and text without attachment bytes. Check: those unit tests pass; shared-module scenario "authenticates over a duplex without opening its own TCP socket" passes.

## 4. Gmail connector and production registry

- [ ] 4.1 Implement the Gmail native connector (`id` `gmail`, name `Gmail`, fields `address` / `password`, constant destinations `imap.gmail.com:993` and `smtp.gmail.com:465`); `checkConnection` opens TLS sessions via egress and requires IMAP LOGIN and SMTP AUTH both succeed; register it in the production registry export. Tests: production list includes `gmail` with correct fields and destinations; create account succeeds against fake IMAP+SMTP; create fails with `Connection check failed` when IMAP rejects or SMTP rejects, without saving and without the fixture password in the response. Check: connector-gmail identity, allowlist, and connection-check scenarios pass; tests that assumed production length 0 are updated to the new contract without relying on production containing fakes.

## 5. Gmail MCP tools

- [ ] 5.1 Implement `list_messages`, `search_messages`, and `read_message` (MCP names `gmail_list_messages`, `gmail_search_messages`, `gmail_read_message`) using the shared module over egress TLS sessions. Arguments: mailbox default `INBOX`; capped limit for list; narrow filter only for search (reject free-form); uid for read. Results: list/search summaries (uid, from, subject, date, seen/unread) without bodies; read returns headers and text body without attachment bytes. Fixture password absent from tool results and MCP errors. Check: connector-gmail tool and password-scrubbing scenarios pass against fake IMAP; `npm run typecheck -w server` exits 0.

## 6. Full package check

- [ ] 6.1 From the repository root: `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build` exit 0. Test names cover every new scenario in the `connector-gmail`, `connector-contract`, `native-egress`, and `accounts-api` deltas. Check: every command exits 0.
