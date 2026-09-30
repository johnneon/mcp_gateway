# Tasks

## 1. Mail.ru connector, registry, and connection check

- [ ] 1.1 Add the native Mail.ru connector (`id` `mailru`, name `Mail.ru`, kind `native`, fields `address` / `password`, constant destinations `imap.mail.ru:993` and `smtp.mail.ru:465`) and register it in the production registry beside Gmail. `checkConnection` opens egress TLS sessions and requires IMAP LOGIN and SMTP AUTH on the shared mail module; it does not send mail and does not open a socket outside the egress client. Do not copy the IMAP/SMTP stack and do not change Gmail's hosts, fields, check, or tools. Tests use fake IMAP and fake SMTP only: production list includes `mailru` with those fields and still includes `gmail`; allowlist is exactly the two Mail.ru hosts; create account succeeds when both fakes accept login; create fails with body `Connection check failed` when IMAP rejects or SMTP rejects, without saving and without the fixture password. Check: connector-mail-ru scenarios for identity, allowlist, both connection-check outcomes, and shared-module duplex login pass; connector-contract scenario "Production export includes Mail.ru alongside Gmail" passes; `npm run typecheck -w server` exits 0.

## 2. Mail.ru MCP tools

- [ ] 2.1 Implement `list_messages`, `search_messages`, and `read_message` (MCP names `mailru_list_messages`, `mailru_search_messages`, `mailru_read_message`) on the shared module over an egress TLS session to `imap.mail.ru:993`. Arguments: mailbox default `INBOX`; list limit default 20 and cap 50; narrow filter only for search (reject free-form syntax and unknown keys); required uid for read. Results: list/search summaries (uid, from, subject, date, seen/unread) without bodies; read returns headers and text body without attachment bytes. Fixture password absent from tool results and MCP errors. Check: connector-mail-ru tool and password-scrubbing scenarios pass against fake IMAP; `npm run typecheck -w server` exits 0.

## 3. Full package check

- [ ] 3.1 From the repository root: `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build` exit 0. Test names cover every new scenario in the `connector-mail-ru`, `connector-contract`, and `connector-gmail` deltas. Check: every command exits 0.
