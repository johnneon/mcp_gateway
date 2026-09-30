# Design

## Context

See `proposal.md` — Why. The production registry is `buildConnectorRegistry([gmailConnector])` in `server/src/connectors/registry.ts`. Gmail (`server/src/connectors/gmail/index.ts`) already opens egress `tlsSession` duplexes and calls the shared module at `server/src/connectors/mail/` (`createImapClient`, `createSmtpClient`, `assertNotFreeFormSearch`). That module speaks only on a provided duplex and does not name a provider host. `checkConnection` already receives the gateway-built egress client. List caps on Gmail are default 20 and max 50. Accepted decisions below are locked and are not reopened.

## Goals / Non-Goals

**Goals:**

- Register Mail.ru in the production registry next to Gmail, reusing the shared IMAP/SMTP module for protocol bytes.
- Mail.ru supplies its own hosts, fields, connection check, and three read tools. Automated tests use the existing fake IMAP and fake SMTP duplexes.

**Non-Goals:**

- Send mail, OAuth, proxy kind, call log, folder management beyond a mailbox name, attachment bytes, live Mail.ru in CI, a second IMAP/SMTP stack, UI product code in propose, edits to `mcp-gateway-spec.md` or `openspec/specs/` during apply.
- Redesigning Gmail. Gmail keeps its hosts, fields, check, and tools. This change does not extract a shared connector factory from the Gmail module.

## Decisions

Accepted decisions below are not reopened. No open questions remain for this change.

### 1. New Mail.ru module, shared protocol stays where it is

- Add `server/src/connectors/mailru/index.ts` (name may match the Gmail file layout). It declares `id` `mailru`, `name` `Mail.ru`, `kind` `native`, fields `address` / `password`, and constant destinations `imap.mail.ru:993` and `smtp.mail.ru:465`.
- Protocol calls go through `server/src/connectors/mail/index.ts`. The Mail.ru module does not copy `imap.ts` or `smtp.ts` and does not open TCP or TLS except via `egressClient.tlsSession`.
- Do not change the shared module's public API for this change. It is already host-agnostic.

**Alternative (rejected):** a second IMAP/SMTP implementation inside the Mail.ru module — rejected; the person locked reuse of the shared module.

**Alternative (rejected):** move Gmail's tool handlers into a shared factory that both connectors call — rejected; that redesigns Gmail. Duplicating the connector shell (hosts, field mapping, check, tools) is accepted.

### 2. Production registry includes both connectors

- `productionConnectorRegistry = buildConnectorRegistry([gmailConnector, mailruConnector])`.
- Gmail remains in the array. Tests that need fakes keep injecting their own registry.
- Existing assertions that require `gmail` to be present stay. New assertions require `mailru` as well.

**Alternative (rejected):** replace Gmail with Mail.ru in the production array — rejected; Gmail stays.

### 3. Connection check matches Gmail's sequence on Mail.ru hosts

- TLS session to `imap.mail.ru:993`, IMAP `login(address, password)` on the shared client, then TLS session to `smtp.mail.ru:465`, SMTP `auth` with the same credentials.
- Both must succeed. No send. Either failure fails the check.
- Admin failure mapping stays the existing fixed body `Connection check failed`. The connector must not put the password or a raw provider error into a message that the admin API would forward. The accounts service already maps check failures to that fixed text.

**Alternative (rejected):** SMTP send during the check — rejected; SMTP is login-only.

### 4. Tools copy the Gmail argument and result shapes

| Short name | MCP name | Arguments | Result |
| --- | --- | --- | --- |
| `list_messages` | `mailru_list_messages` | `mailbox` optional default `INBOX`; `limit` integer, default 20 when omitted, capped at 50 | Summaries: uid, from, subject, date, seen/unread; no body |
| `search_messages` | `mailru_search_messages` | `mailbox` optional default `INBOX`; filter object only: `unseen?`, `from?`, `subject?`, `since?` | Same summary shape; reject free-form IMAP search strings and unknown filter keys |
| `read_message` | `mailru_read_message` | `mailbox` optional default `INBOX`; required `uid` | Headers from/to/subject/date + text body; no attachment bytes; names optional when the shared fetch already has them |

- Caps are constants on the Mail.ru module (`20` and `50`), the same numbers as Gmail. Do not import Gmail's constants and do not edit Gmail to share them.
- English tool descriptions match the Gmail wording (mailbox summaries, narrow filter, read by uid). No URL, host, secret, or raw IMAP command in model arguments.
- Handlers follow the Gmail pattern: `tlsSession` to the Mail.ru IMAP host, `createImapClient`, `login`, `select`, then `search` / `fetchSummaries` / `fetchMessage`. Search uses `assertNotFreeFormSearch` and the shared filter type. Unknown filter keys and string `filter` / free-form query arguments fail before a SEARCH is written to the fake server.

### 5. Tests use existing fakes

- Reuse `server/test/connectors/mail/fake-imap.ts` and `fake-smtp.ts`.
- Add a Mail.ru fake egress (same shape as `server/test/connectors/gmail/fake-egress.ts`) that returns those duplexes for `imap.mail.ru:993` and `smtp.mail.ru:465`.
- No live Mail.ru, no DNS, no network to Mail.ru.
- Account create/check tests go through the admin app the same way Gmail tests do. Tool tests go through the MCP app with an injected registry that includes the Mail.ru connector.
- A test that the connector does not open a socket outside egress: the fake egress counts `tlsSession` calls, and the test does not provide a real network.

### 6. Gmail spec prohibition only

- Apply does not edit `openspec/specs/` or Gmail product behavior.
- The delta under `specs/connector-gmail/` removes the sentence `This change SHALL NOT register a Mail.ru connector.` Archive merges that delta. The shared-module scenario stays.

## Risks / Trade-offs

- [Duplicated connector shell next to Gmail] → Mitigation: accepted. Extracting a factory would redesign Gmail, which this change does not do. The protocol stays in one module.
- [Same numeric caps declared twice] → Mitigation: Mail.ru constants are 20 and 50, asserted by the list scenario. Gmail's constants are left alone.
- [Existing tests that only assert `gmail` is present] → Mitigation: those assertions remain true. Add Mail.ru assertions; do not remove the Gmail ones.
- [Password in a thrown IMAP error] → Mitigation: same scrubbing path as Gmail; tests assert the fixture secret is absent from tool text and MCP error text.
- [Shared module change accidentally required] → Mitigation: the module has no provider host. If a Mail.ru test needs a protocol change, stop and report it instead of forking a second stack.

## Migration Plan

- Single process restart after merge. No store document migration. Existing Gmail accounts stay on connector id `gmail`.
- Rollback: revert the change branch / pull request. Mail.ru accounts created after deploy would not resolve if the connector is removed; that is the same rollback shape as any product connector.

## Open Questions

None. Locked decisions cover id `mailru`, display name `Mail.ru`, kind `native`, fields, hosts, both-login check, tool names and shapes, caps 20/50, shared-module reuse, fake-only tests, Gmail staying as-is aside from dropping the registration prohibition, and no new admin page.
