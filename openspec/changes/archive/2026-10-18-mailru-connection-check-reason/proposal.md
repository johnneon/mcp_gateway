# Proposal

Issue: #52

## Why

A Mail.ru account whose application password is scoped to mailbox read authenticates with IMAP LOGIN on `imap.mail.ru:993`, then fails SMTP AUTH on `smtp.mail.ru:465`. The Mail.ru connector has no send tool, but `checkConnection` still requires that SMTP AUTH. The admin API maps the failure to the fixed text `Connection check failed` and does not save the account. The accepted outcome is to treat IMAP LOGIN as enough for the check.

## What Changes

- **BREAKING** for the current Mail.ru check contract: `checkConnection` succeeds after IMAP LOGIN on `imap.mail.ru:993` only. It does not open a TLS session to `smtp.mail.ru:465` and does not perform SMTP AUTH.
- An IMAP LOGIN failure still fails the check. Create, credential patch, and `POST /api/accounts/:id/check` keep the admin failure body exactly `Connection check failed`. The body does not include connector exception text, the raw provider line, or the password.
- Mail.ru hosts stay the constant pairs `imap.mail.ru:993` and `smtp.mail.ru:465`. Fields stay `address` and `password` (label `App password`). IMAP tools stay as they are.
- Gmail `checkConnection` still checks IMAP and SMTP.
- Automated tests stay on fake IMAP behind a fake egress transport. They do not contact a live Mail.ru mailbox.

When the product vision and this accepted approach differ, this approach wins for the duration of the change. Vision still lists Mail.ru hosts as IMAP and SMTP; this change leaves those hosts declared and stops using SMTP during the check.

## Non-goals

- Sending mail, an SMTP tool, or bringing SMTP back into the Mail.ru check.
- A new error taxonomy that distinguishes network failures from authentication failures.
- Changing the fixed API text `Connection check failed`.
- Forwarding connector exception text, the raw provider line, or the password.
- A POP3 client. The password may also allow POP3; this change does not speak POP3.
- Changing Gmail `checkConnection`, Mail.ru fields, Mail.ru hosts, or Mail.ru IMAP tools.
- Live Mail.ru in automated tests.
- Edits to `mcp-gateway-spec.md` or files under `openspec/specs/` during apply.

## Capabilities

### New Capabilities

### Modified Capabilities

- `connector-mail-ru`: The connection check succeeds after IMAP LOGIN only and does not open SMTP. The shared-module check scenario no longer requires SMTP AUTH. Admin failure text stays `Connection check failed`.

## Impact

- `server/src/connectors/mailru/index.ts`: `checkConnection` stops after IMAP LOGIN and does not open the SMTP destination.
- `server/test/connectors/mailru/mailru.test.ts`: replace the SMTP-rejection failure case with a success case that asserts no SMTP session. Keep the IMAP-rejection case and the fixed failure body.
- Accounts service and admin UI stay as they are. They already map a failed check to `Connection check failed`.
- Gmail connector code and `openspec/specs/accounts-api` stay unchanged.
