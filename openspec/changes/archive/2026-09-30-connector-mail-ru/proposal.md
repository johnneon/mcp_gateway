# Proposal

Issue: #22

## Why

The production registry already exposes Gmail over the shared IMAP/SMTP module, but an operator still cannot add a Mail.ru mailbox. Vision lists Mail.ru with an address, an app password, and the hosts `imap.mail.ru:993` and `smtp.mail.ru:465`. This change registers that connector on the same module so the app password stays inside the process.

## What Changes

- Register a native connector with id `mailru`, display name `Mail.ru`, kind `native`. Account fields: `address` (text, required, label `Address`) and `password` (secret, required, label `App password`). Allowed destinations are code constants `{ host: imap.mail.ru, port: 993 }` and `{ host: smtp.mail.ru, port: 465 }`. Hosts do not come from model arguments or from account fields of type `host`.
- `checkConnection` opens a TLS session to `imap.mail.ru:993` and performs IMAP LOGIN with `address` and `password`, then a TLS session to `smtp.mail.ru:465` and performs SMTP AUTH with the same credentials. The check succeeds only when both authentications succeed. It does not send mail. On failure the admin API stays the fixed plain text `Connection check failed` with no connector exception text and no password.
- Reuse the existing shared IMAP/SMTP module at `server/src/connectors/mail/`. The Mail.ru connector supplies hosts, field mapping, connection check, and tools. It does not embed a second IMAP/SMTP stack.
- Tools, same shapes as Gmail. MCP names are `mailru_` plus the short name. Model arguments contain no URL, host, secret, or raw IMAP command string:
  - `list_messages` → `mailru_list_messages`: optional mailbox defaulting to `INBOX`, limit integer capped by a code constant (same caps as Gmail: default 20, max 50). Summaries: uid, from, subject, date, seen/unread. No body.
  - `search_messages` → `mailru_search_messages`: optional mailbox default `INBOX`; narrow filter object only (`unseen` boolean, `from` string, `subject` substring, `since` date string). Same summary shape. Reject free-form IMAP search syntax and unknown filter keys.
  - `read_message` → `mailru_read_message`: optional mailbox default `INBOX`, required `uid`. Headers from, to, subject, date, and text body. No attachment bytes. Attachment names may be included when available without fetching attachment payloads.
- The app password must not appear in tool result text, MCP error text, or admin API response bodies.
- Production registry includes `mailru` alongside existing product connectors (`gmail` stays).
- The live Gmail requirement "Shared mail protocol is separate from the Gmail connector" drops the sentence that forbids registering a Mail.ru connector. IMAP/SMTP protocol logic stays in the shared module. Gmail still supplies its own hosts, fields, check, and tools.
- No new admin UI page. The existing account form is driven by connector fields.
- Automated tests use fake IMAP and fake SMTP and do not contact a live Mail.ru mailbox.

When the product vision and this accepted approach differ, this approach wins for the duration of the change.

## Non-goals

- Sending mail (no send tool). SMTP is login-only during the connection check.
- OAuth.
- Proxy kind.
- Call log.
- Folder or label management beyond selecting a mailbox name.
- Attachment download (bytes).
- Live Mail.ru in CI or automated tests.
- A second IMAP/SMTP stack inside the Mail.ru module.
- Edits to `mcp-gateway-spec.md` or files under `openspec/specs/` during apply (sync at archive).
- UI product code in this propose step.

## Capabilities

### New Capabilities

- `connector-mail-ru`: Native Mail.ru connector — account fields and constant IMAP/SMTP hosts, connection check (IMAP LOGIN and SMTP AUTH over the egress TLS session), read tools (`list_messages`, `search_messages`, `read_message`), reuse of the shared mail protocol module, password never in tool results, MCP errors, or admin responses.

### Modified Capabilities

- `connector-contract`: Production registry includes `mailru` alongside existing product connectors (`gmail` stays).
- `connector-gmail`: Requirement "Shared mail protocol is separate from the Gmail connector" no longer forbids registering a Mail.ru connector. The shared-module rule stays: protocol logic remains in the shared module; Gmail still supplies its own hosts, fields, check, and tools.

## Impact

- New module under `server/src/connectors/mailru/` for hosts, fields, `checkConnection`, and tools. It calls the existing shared module in `server/src/connectors/mail/`.
- `server/src/connectors/registry.ts`: production registry array includes the Mail.ru module next to Gmail.
- Tests: fake IMAP and fake SMTP behind a fake egress transport (the fakes already used by the shared module and Gmail). No live Mail.ru mailbox.
- Admin UI: no new page; Mail.ru appears through the existing connectors list and field-driven account form once the connector is registered.
- `mcp-gateway-spec.md` and `openspec/specs/` stay unchanged until archive.
