# Design

## Context

See proposal.md for why the Mail.ru check changes. Today `mailruCheckConnection` in `server/src/connectors/mailru/index.ts` opens TLS to `imap.mail.ru:993`, runs IMAP LOGIN through `createImapClient`, then opens TLS to `smtp.mail.ru:465` and runs SMTP AUTH through `createSmtpClient`. The accounts service already catches any rejection and throws `ConnectionCheckFailedError`, whose message is exactly `Connection check failed`. Gmail `checkConnection` still does both protocols. Mail.ru tools already use IMAP only.

## Goals / Non-Goals

**Goals:**

- Make Mail.ru `checkConnection` return after a successful IMAP LOGIN and open no SMTP session.
- Keep create, credential patch, and `POST /api/accounts/:id/check` on that same function so they succeed or fail with it.
- Prove with fakes that a rejecting SMTP server is never contacted.

**Non-Goals:**

- See proposal.md. This design does not add an error taxonomy, a POP3 client, or an SMTP tool.

## Decisions

### Stop after IMAP LOGIN

Remove the SMTP session from `mailruCheckConnection` only. The function still takes account values and the egress client, opens one TLS session to the existing `MAILRU_IMAP_HOST` / `MAILRU_IMAP_PORT` constants, calls `createImapClient`, and `login` with `address` and `password`. It still closes the IMAP client and destroys the duplex. It does not call `createSmtpClient` or `tlsSession` for `smtp.mail.ru:465`.

Alternative considered: open SMTP and treat an authentication failure as success. Rejected. The accepted outcome is not to open an SMTP session.

Alternative considered: drop `smtp.mail.ru:465` from `allowedDestinations`. Rejected. The accepted outcome keeps Mail.ru hosts. The constants and the allowlist pair stay so the declared destinations do not change. Nothing in this change connects to that destination.

### Leave the admin failure mapping alone

Do not edit `ConnectionCheckFailedError` or `runCheckConnection`. A failed IMAP LOGIN still rejects, the service still replaces the exception with `Connection check failed`, and the response body stays that exact text. The shared IMAP client already replaces a failed LOGIN with its own fixed message before the service maps it again. Tests assert the HTTP body, not a new error type.

### Do not change Gmail or the shared mail module

Gmail `checkConnection` keeps IMAP LOGIN and SMTP AUTH. The shared IMAP and SMTP clients stay. Mail.ru simply stops calling the SMTP client. After the call is gone, drop the unused `createSmtpClient` import from the Mail.ru module so lint stays clean.

### Tests stay on the existing fake

Extend `createMailruFakeEgressTransport` to record each `tlsSession` host and port. Existing tool tests keep passing an `smtp` option. The new check tests set that fake SMTP server to reject AUTH and assert the recorded sessions include `imap.mail.ru:993` and exclude `smtp.mail.ru:465`.

The current test `Failed check when fake SMTP rejects AUTH` asserts the old contract. Replace it with the successful-create scenario. Update `Mail.ru login uses the shared module over the egress duplex` so it expects one IMAP session and no SMTP session, still asserts the module imports the shared mail client, and no longer requires `createSmtpClient` in the Mail.ru source. Do not delete the assertions that the module does not open `node:net` or `node:tls`. Do not edit a passing assertion to hide a product bug; these edits follow the new scenarios.

No live Mail.ru mailbox. No new admin UI copy.

## Risks / Trade-offs

- [An IMAP-only application password can now be saved, and the account still cannot send mail] → Accepted. Mail.ru has no send tool. A later send tool has to decide its own SMTP check.
- [The allowlist still names an SMTP host that the check does not use] → Accepted so the declared hosts stay stable. Egress will allow that destination if a later change opens it.
- [Operators still see only `Connection check failed` when IMAP LOGIN fails] → Accepted. Distinguishing network failures from authentication failures is out of scope.

## Migration Plan

No store migration and no environment change. Accounts already saved stay saved. Rollback is restoring the SMTP AUTH step in `mailruCheckConnection`.

## Open Questions

None. The accepted outcome fixes the check to IMAP LOGIN only and leaves the failure text, hosts, fields, and Gmail check unchanged.
