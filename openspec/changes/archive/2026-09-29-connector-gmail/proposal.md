# Proposal

Issue: #17

## Why

The gateway can store accounts and dispatch native tools through an allowlisted egress client, but the production registry is still empty. Without a Gmail connector, an operator cannot add a mailbox or let a model read mail through MCP while keeping the app password inside the process.

## What Changes

- Register a native connector with id `gmail`, display name `Gmail`, kind `native`. Account fields: `address` (text, required, label `Address`) and `password` (secret, required, label `App password`). Allowed destinations are code constants `{ host: imap.gmail.com, port: 993 }` and `{ host: smtp.gmail.com, port: 465 }`.
- **BREAKING** for the connector contract: the production registry export includes this connector (it is no longer length 0). Tests that need a fake still inject their own registry and must not rely on the production export containing that fake.
- **BREAKING** for connection checks: `checkConnection` receives the same gateway-built egress client as tool handlers. The accounts service builds that client from the connector allowlist and the account values and passes it in (the deferral from native-egress-guard). Both IMAP LOGIN and SMTP AUTH must succeed for the check to pass. Failure still surfaces to the admin API as the fixed plain text `Connection check failed` (no connector exception text, no password).
- **BREAKING** for native egress: add a TLS session operation that returns a duplex stream and leaves it open after the allowlist check. Same production timeout (30s) and max size (64 MiB) as existing egress. Keep existing HTTPS and handshake-only `tlsConnect` behavior. The client no longer exposes exactly two operations. Mail code uses the session path. Tests inject a fake transport; no live provider.
- Shared IMAP/SMTP protocol module speaks over the egress duplex (not ImapFlow, not Nodemailer). Gmail only supplies hosts, field mapping, connection check, and tools. A MIME parsing library with no network I/O is allowed for reading a message body when needed.
- Tools (MCP names = connector id + underscore + short name). Model arguments contain no URL, host, or secret, and no raw IMAP command string:
  - `list_messages` → `gmail_list_messages`: mailbox defaulting to `INBOX`, capped limit, summary only (uid, from, subject, date, seen/unread). No body.
  - `search_messages` → `gmail_search_messages`: mailbox plus a narrow filter only (unseen, from, subject substring, since date). Same summary shape. Reject free-form IMAP search syntax.
  - `read_message` → `gmail_read_message`: mailbox + uid. Headers (from, to, subject, date) and text body. No attachment bytes (attachment names may be included if cheap).
- The app password must never appear in tool results, MCP errors, or admin responses (existing scrubbing plus connector and check paths that do not forward secrets).
- No new admin UI page: the existing account form is driven by connector fields. Verify will exercise that screen in the browser; this propose step does not implement UI code.

When the product vision and this accepted approach differ, this approach wins for the duration of the change (production registry non-empty; `checkConnection` receives egress; TLS session duplex).

## Non-goals

- Sending mail (no send tool). SMTP is login-only during connection check.
- Mail.ru connector.
- OAuth.
- Proxy kind.
- Call log.
- Folder/label management beyond selecting a mailbox name.
- Attachment download (bytes).
- Live Gmail in CI or automated tests.
- Edits to `mcp-gateway-spec.md` or files under `openspec/specs/` during apply (sync at archive).
- UI product code in this propose step.

## Capabilities

### New Capabilities

- `connector-gmail`: Native Gmail connector — account fields and constant IMAP/SMTP hosts, connection check (IMAP LOGIN and SMTP AUTH over the egress TLS session), read tools (`list_messages`, `search_messages`, `read_message`), shared mail protocol module used only through egress duplexes and fake IMAP/SMTP servers in tests, password never in tool results, MCP errors, or admin responses.

### Modified Capabilities

- `connector-contract`: Production registry registers the Gmail connector (no longer empty); `checkConnection` receives the gateway-built egress client; remove requirements and scenarios that assert production length 0 or that `checkConnection` omits the egress client; allowed-destination text no longer forbids registering Gmail.
- `native-egress`: Add an allowlist-checked TLS session operation that returns an open duplex; the client no longer exposes exactly two operations; keep HTTPS and handshake `tlsConnect`; drop "production registry remains empty" where it blocks a product connector.
- `accounts-api`: On create, patch (when check runs), and explicit check, the accounts service builds the egress client from the connector allowlist and account values and passes it to `checkConnection`; failure body stays `Connection check failed` without exception text or password; drop "production registry remains empty" where it conflicts.

## Impact

- New modules under `server/src/connectors/` for Gmail, shared IMAP/SMTP over egress duplex, and production registry wiring that includes Gmail.
- `server/src/connectors/contract.ts` and `native/egress.ts`: `checkConnection` signature gains egress client; TLS session on the egress client and transport.
- `server/src/accounts/service.ts`: build egress client and pass it into `checkConnection`.
- Tests: fake IMAP and fake SMTP servers (no live mailbox); fake egress transport for session duplex; inject fakes where tests need them; update scenarios that assumed an empty production registry or checkConnection without egress.
- Admin UI: no new page; Gmail appears via existing connectors list and field-driven account form once the connector is registered.
