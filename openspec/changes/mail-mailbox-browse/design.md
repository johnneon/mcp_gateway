# Design

## Context

See `proposal.md` — Why. Current behavior is `openspec/specs/connector-gmail/spec.md`, `openspec/specs/connector-mail-ru/spec.md`, and `server/src/connectors/mail/imap.ts`.

Both connectors open an egress TLS duplex to their constant IMAP host and call `createImapClient`. That client speaks only on the duplex: `login`, `select`, `search`, `fetchSummaries`, `fetchMessage`. `list_messages` takes the last `limit` UIDs (`slice`) and returns a bare JSON array. `search_messages` returns every match, also as a bare array. There is no LIST, CREATE, or MOVE. Gmail and Mail.ru each copy the handler. Password scrubbing already runs in `server/src/mcp/call.ts` (`scrubSecretsInText`). A tagged `NO`/`BAD` line is thrown as the server text, except LOGIN, which is replaced with `IMAP login failed`. The fake IMAP server is one implicit mailbox. Tests must stay on that fake and must not open a live mailbox.

The delta specs are the contract. This design only records how to meet them.

## Goals / Non-Goals

**Goals:**

- One date-sort and page implementation, and one LIST / CREATE / UID MOVE implementation, in the existing shared IMAP client.
- Both connectors call that client. Tool schemas stay on each connector. Hosts stay the connector constants.
- The fake IMAP server grows folders, CREATE, and MOVE without breaking existing INBOX SEARCH and FETCH tests.

**Non-Goals:**

- A second IMAP stack, a shared connector factory, IMAP SORT, COPY, STORE flags, EXPUNGE as a product tool, or SMTP send.
- Changing `read_message`, connection check, account fields, or allowlists.
- Editing `mcp-gateway-spec.md` or `openspec/specs/` during apply.

## Decisions

Accepted decisions below are not reopened.

### 1. Extend the existing IMAP client; do not add another

- Add mailbox list, create, and move on `createImapClient` in `server/src/connectors/mail/imap.ts`. The client still has no host and still does not open a socket.
- Commands the client writes, built from validated arguments, not from a model command string: `LIST "" "*"`, `CREATE` with the existing quoted atom, `UID MOVE <uid> <quoted destination>` after `SELECT` of the source.
- Both connectors keep `tlsSession` to their own host (`imap.gmail.com:993` or `imap.mail.ru:993`) and call this client. They do not copy `imap.ts`.

**Alternative (rejected):** a second IMAP parser inside either connector — rejected; the proposal forbids a second stack.

**Alternative (rejected):** a connector factory that merges the Gmail and Mail.ru modules — rejected; this change shares protocol and paging only. Each module still owns its id, hosts, fields, check, and tool list.

### 2. Sort in the process by the Date header, then cut the page

- `fetchSummaries` already returns the Date header string on `MessageSummary.date`. Load summaries for the full matching UID set, sort, then slice. Do not slice UIDs before the sort. UID order is not date order.
- Parse with `Date.parse`. A date that does not parse sorts as older than every date that does.
- Equal parsed dates: `newest` puts the higher uid first; `oldest` puts the lower uid first. With the current equal-date fixtures, `newest` therefore still starts at the highest uid.
- Page math lives in one shared function both handlers call. Applied `offset` and `limit` follow the delta: omitted, non-integer, or negative offset becomes 0; omitted, non-integer, or limit below 1 becomes 20; limit above 50 becomes 50; omitted order is `newest`; any other order throws `Invalid order` before SEARCH.
- The envelope is `{ messages, total, offset, limit }` with the applied offset and limit. Each message keeps `uid`, `from`, `subject`, `date`, `seen`, and `unread` (`unread` is the opposite of `seen`). No body.
- `search` still uses `assertNotFreeFormSearch` and `buildImapSearchCriteria`. Paging runs on the filtered summaries. `total` is the match count.
- Caps 20 and 50 are one pair of constants in the mail module. Gmail and Mail.ru re-export them under the existing `GMAIL_LIST_*` and `MAILRU_LIST_*` names so current imports keep working.

**Alternative (rejected):** IMAP SORT — rejected; the fake server would need a new extension, and the sort key would no longer be the date string the tool already returns.

**Alternative (rejected):** page by UID, then sort the page — rejected; the delta sorts the matching set before the cut.

### 3. Folder tools on the same client

- `listMailboxes` returns the name strings from LIST, once each. The tool result is a JSON array of those strings. No host property on the schema.
- `createMailbox` rejects a name that is empty or only whitespace with `Mailbox name is required` and does not send CREATE. Success JSON is `{ name }`.
- `moveMessage` checks the LIST names first. If the destination is absent, it throws `Destination mailbox does not exist` and does not send MOVE, so the message stays in the source. It does not SELECT the missing mailbox. A uid that is missing, not an integer, or below 1 throws `uid is required` and does not send MOVE.
- Success JSON is `{ uid, source, destination }` using the source uid. The destination uid may differ. Tests identify the moved message by subject and from.
- Mailbox names are quoted by the client. The model never passes a raw IMAP command.

**Alternative (rejected):** COPY plus delete — rejected; copy without move is a non-goal. UID MOVE is the only write.

**Alternative (rejected):** create the destination when it is missing — rejected; the delta says the tool fails and the message stays.

### 4. Errors and the password

- English error texts above are the thrown messages. Tool descriptions stay English and do not include a URL, a host, or a secret. Schemas set `additionalProperties: false` and do not declare host, URL, secret, or command fields.
- Do not catch a MOVE `NO`/`BAD` and replace it with a new string that might be built from the password. Leave the server line as the error, as `runTagged` already does for non-LOGIN commands. `scrubSecretsInText` in the MCP call path removes the fixture password. LOGIN and the admin connection check stay on their fixed messages.
- The move password scenario configures the fake so the MOVE `NO` text contains the fixture password. It goes through the real handler, not a stubbed tool.

### 5. Fake IMAP stays in-process

- Extend `server/test/connectors/mail/fake-imap.ts`. Default mailbox map is `INBOX` filled from `options.messages`, so existing SEARCH and FETCH tests still select INBOX.
- Add LIST, CREATE, and UID MOVE. SELECT of a name that is not in the map fails and does not create a mailbox. CREATE adds an empty mailbox. UID MOVE removes the uid from the selected mailbox and appends the message to the destination (a new uid is allowed).
- A test option makes MOVE reply `NO` with a caller-supplied line and not move the message. That line is how the password-scrub scenario injects the fixture secret.
- No TCP listener, no DNS, no live Gmail or Mail.ru.

### 6. Existing tool tests follow the modified scenarios

- Tests that parse `list_messages` or `search_messages` as a bare array change to the envelope because the requirement changed. Keep the checks that the page has no body and no fixture password, and that search still rejects a free-form string before a SEARCH is written.
- Do not delete or weaken those assertions to match today's array. The new scenarios are the expected values.
- `read_message` tests stay as they are.

## Risks / Trade-offs

- [Every matching summary is fetched before the page is cut] → Accepted. A later change can narrow the fetch. This change does not add IMAP SORT or a second index.
- [Equal dates need a uid tie-break or the page is unstable] → Locked: higher uid is newer. The equal-date cap scenario asserts uids 60 down to 11.
- [A destination uid differs from the source uid] → Success is source uid gone and the destination summary carrying the same subject and from.
- [SELECT of an unknown name used to succeed on the fake] → No current test passes a mailbox other than the default. After this change, unknown SELECT fails. INBOX still exists.
- [Breaking JSON shape for list and search] → Callers read `messages`. `total` is how they know another page exists. No stored document changes.
- [Duplicated tool schemas on the two connectors] → Accepted. Shared helpers own sort, page, LIST, CREATE, and MOVE so the schemas cannot drift in behavior.

## Migration Plan

- No store migration and no admin UI change. Restart picks up the new tools.
- Rollback is reverting the pull request. Accounts and bearers stay. Clients that already read the envelope would see the old bare array again only if this change is reverted before they ship.

## Open Questions

None. Locked here, and already in the delta specs where the behavior is visible: page defaults and the cap of 50, date sort before the cut, uid tie-break, unparseable dates sorting as oldest, envelope fields, exact English errors for order, empty name, missing destination, and uid, LIST-before-MOVE, UID MOVE rather than COPY, in-process sort, and fake-only tests.
