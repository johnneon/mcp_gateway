# Design

## Context

See `proposal.md` — Why. Native tools already receive a gateway-built egress client (`createEgressClientForAccount` in `server/src/connectors/native/egress.ts`) with HTTPS and handshake-only `tlsConnect` (connect then `socket.end()`). Accounts create/patch/check call `checkConnection(values)` only (`server/src/accounts/service.ts`). The production registry is `buildConnectorRegistry([])`. Vision lists Gmail with address + app password and hosts `imap.gmail.com:993` / `smtp.gmail.com:465`. Accepted decisions below are locked and are not reopened.

**Accepted precondition (confirmed by the person before propose):** Gmail app passwords are usable on the target mailbox (2FA enabled and/or Google Workspace policy allows app passwords). Operators who cannot create an app password are outside this change's support path; the connector still uses app-password fields only (no OAuth in this change).

## Goals / Non-Goals

**Goals:**

- Register Gmail in the production registry; wire `checkConnection` through the same egress client as tools; add a TLS session duplex for IMAP/SMTP bytes.
- Shared IMAP/SMTP module over that duplex; Gmail tools for list/search/read; fake IMAP/SMTP in automated tests.

**Non-Goals:**

- Send mail, Mail.ru, OAuth, proxy kind, call log, folder management beyond mailbox name, attachment bytes, live Gmail in CI, UI product code in propose, edits to `mcp-gateway-spec.md` / `openspec/specs/` during apply.

## Decisions

Accepted decisions below are not reopened. No open questions remain for this change.

### 1. Production registry registers Gmail

- `productionConnectorRegistry = buildConnectorRegistry([gmailConnector])` (or equivalent array that includes the Gmail module).
- Tests that need fakes continue to inject `buildConnectorRegistry([fake, ...])` into admin/MCP factories.
- Update or replace assertions that expected production list length 0.

**Alternative (rejected):** keep production empty and load Gmail only in main — rejected; person locked production registry includes the connector.

### 2. checkConnection receives the egress client

- `CheckConnection` becomes `(accountValues, egressClient) => void | Promise<void>`.
- Accounts service builds the client with `createEgressClientForAccount` from the connector's `allowedDestinations` and the values under check, then passes it on create, patch (when check runs), and explicit check.
- Admin failure mapping stays: catch → fixed `Connection check failed`; no exception text; no password in responses.
- Tool handlers already receive the same client shape.

**Alternative (rejected):** leave checkConnection without egress and open sockets inside Gmail — rejected; would bypass allowlist; deferred work from native-egress-guard is done here.

### 3. TLS session duplex on egress

- Add `tlsSession({ host, port })` (final name may match code style) that allowlist-checks, then returns an open duplex from the transport.
- Keep `tlsConnect` as handshake-then-end for existing behavior and tests.
- Keep HTTPS unchanged.
- Production timeout 30s and max size 64 MiB apply; tests inject fakes and smaller limits.
- Fake transport gains a session method that returns a duplex the mail protocol can speak on.

**Alternative (rejected):** reuse handshake-only `tlsConnect` for mail — rejected; it ends the socket and cannot carry IMAP/SMTP bytes.

### 4. No ImapFlow; no Nodemailer; shared protocol over duplex

- ImapFlow opens its own TCP/TLS and has no public API to take an already-connected TLS socket; it would bypass the allowlist.
- Nodemailer is out of this change (no send tool; SMTP is AUTH-only for check).
- Implement a small shared IMAP/SMTP client that reads/writes lines on the egress duplex (LOGIN/AUTH, SELECT, SEARCH built from a narrow filter struct, FETCH headers/body).
- Optional MIME parse library with **no network I/O** may decode a message body for `read_message`.
- Gmail module: hosts, field mapping, `checkConnection`, three tools. Shared module is not the Gmail connector. Mail.ru is a non-goal.

**Alternative (rejected):** ImapFlow with a custom socket hook if one existed — it does not; rejected.

### 5. Connection check = IMAP LOGIN and SMTP AUTH

- Open TLS session to `imap.gmail.com:993`, IMAP LOGIN with `address` / `password`.
- Open TLS session to `smtp.gmail.com:465`, SMTP AUTH (LOGIN or PLAIN as implemented) with the same credentials.
- Both must succeed. No MAIL FROM / DATA. Failure of either fails the check.

### 6. Tools and argument shapes

| Short name | MCP name | Arguments | Result |
| --- | --- | --- | --- |
| `list_messages` | `gmail_list_messages` | `mailbox` optional default `INBOX`; `limit` integer capped by a code constant (design default: max 50, default 20 if omitted) | Summaries: uid, from, subject, date, seen/unread; no body |
| `search_messages` | `gmail_search_messages` | `mailbox` optional default `INBOX`; filter object only: `unseen?`, `from?`, `subject?`, `since?` | Same summary shape; reject free-form IMAP search strings and unknown filter keys |
| `read_message` | `gmail_read_message` | `mailbox` optional default `INBOX`; required `uid` | Headers from/to/subject/date + text body; no attachment bytes; names optional if cheap |

- No URL, host, secret, or raw IMAP command in model arguments.
- Gateway account injection and secret scrubbing remain; Gmail must not put the password in results or thrown messages that reach the client after scrubbing.

### 7. Fake IMAP and fake SMTP for tests

- Automated tests drive fake servers (or duplex protocol fakes) behind the fake egress transport.
- No live Gmail, no live network to Google.
- Verify (later) exercises the existing field-driven account form in the browser; no new UI page.

### 8. App password precondition

- Recorded as an accepted operator precondition (see Context). Not an open question. Connector fields remain address + app password only.

## Risks / Trade-offs

- [Hand-rolled IMAP/SMTP vs mature libraries] → Mitigation: narrow command set only; fakes cover LOGIN/AUTH, list, search, fetch; no free-form search from the model.
- [Breaking checkConnection signature for all fakes] → Mitigation: update test fakes in the same tasks; production had no real connectors before Gmail.
- [Tests that asserted production length 0] → Mitigation: update those scenarios and tests to expect Gmail present; keep fake injection for non-product ids.
- [64 MiB session reads for large messages] → Mitigation: same egress cap as HTTPS; abort oversized; no attachment bytes in tool results.
- [App password / Workspace policy] → Mitigation: precondition confirmed; document in design only; OAuth remains a non-goal.

## Migration Plan

- Single process restart after merge; no store document migration.
- Existing accounts for other connectors (none in production today) would need checkConnection signature updates only in test fakes.
- Rollback: revert the change branch / PR.

## Open Questions

None. Locked decisions cover registry, egress on checkConnection, TLS session duplex, no ImapFlow/Nodemailer, shared mail module, tool set and filters, fake-only verification, and the app-password precondition.
