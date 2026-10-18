# Tasks

## 1. IMAP-only Mail.ru check

- [x] 1.1 Stop `mailruCheckConnection` after IMAP LOGIN on `imap.mail.ru:993`. Do not open `smtp.mail.ru:465` and do not call SMTP AUTH. Keep the IMAP host constants, the SMTP host constants, `allowedDestinations`, the `address` and `password` fields, and the IMAP tools. Drop the unused SMTP client import from the Mail.ru module. Do not change Gmail `checkConnection`, `ConnectionCheckFailedError`, or the accounts service mapping. Record each fake egress TLS host and port. Cover the delta scenarios in `connector-mail-ru`: create returns 201 when fake IMAP accepts LOGIN even though fake SMTP would reject AUTH, and the recorded sessions include `imap.mail.ru:993` and exclude `smtp.mail.ru:465`; create returns exactly `Connection check failed` with no save and no fixture password when fake IMAP rejects LOGIN, and still opens no SMTP session; `POST /api/accounts/:id/check` returns 200, leaves the store unchanged, and opens no SMTP session; a password patch returns 200, stores the new fixture password, omits it from the body, and opens no SMTP session; the shared-module check opens only the IMAP session and still does not open a socket outside egress. Replace the old assertion that SMTP AUTH rejection fails the check. Tests use fakes only. Check: `server/test/connectors/mailru/mailru.test.ts` passes for those scenarios; `npm run typecheck -w server` exits 0.

## 2. Full package check

- [ ] 2.1 From the repository root, `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`, and `npm run build` exit 0. Do not edit `mcp-gateway-spec.md` or `openspec/specs/`. Check: every command exits 0.
