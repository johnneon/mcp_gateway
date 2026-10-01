# Design

## Context

See `proposal.md` — Why. Current behavior is `openspec/specs/connector-gmail/spec.md`, `openspec/specs/connector-mail-ru/spec.md`, and `server/src/connectors/mail/imap.ts`.

Both connectors open an egress TLS duplex to their constant IMAP host and call `createImapClient`. That client speaks only on the duplex: `login`, `select`, `search`, `fetchSummaries`, `fetchMessage`. `fetchSummaries` asks for From, Subject, and Date, then `list_messages` takes the last `limit` UIDs and returns a bare JSON array. The handler default is 20 and the cap is 50 (`GMAIL_LIST_DEFAULT_LIMIT`, `GMAIL_LIST_MAX_LIMIT`, and the Mail.ru pair). `search_messages` returns every match as a bare array. `fetchMessage` returns headers plus `textBody` and may include `attachmentNames`. There is no LIST, CREATE, RENAME, DELETE, COPY, MOVE, or STORE. Gmail and Mail.ru each copy the handler. Password scrubbing already runs in `server/src/mcp/call.ts` (`scrubSecretsInText`). A tagged `NO`/`BAD` line is thrown as the server text, except LOGIN, which is replaced with `IMAP login failed`. The fake IMAP server is one implicit mailbox. Tests must stay on that fake and must not open a live mailbox.

The delta specs are the contract. This design only records how to meet them.

## Goals / Non-Goals

**Goals:**

- One implementation of date sort, uncapped paging, LIST special-use, folder create/rename/delete, UID MOVE, UID COPY, UID STORE for `\Seen` and `\Flagged`, MIME read, and attachment bytes, in the existing shared IMAP client.
- Both connectors call that client. Tool schemas stay on each connector. Hosts stay the connector constants.
- The fake IMAP server grows folders, attributes, MIME parts, and the new commands without breaking existing INBOX SEARCH and FETCH tests.

**Non-Goals:**

- A second IMAP stack, a shared connector factory, IMAP SORT, SMTP send, EXPUNGE, or `\Deleted` as a product operation.
- Hard-coded provider folder names.
- A new account-selection tool, or an edit to the connector contract.
- Changing connection check, account fields, or allowlists.
- Editing `mcp-gateway-spec.md` or `openspec/specs/` during apply.

## Decisions

Accepted decisions below are not reopened.

### 1. Extend the existing IMAP client; do not add another

- Add the new operations on `createImapClient` in `server/src/connectors/mail/imap.ts`. The client still has no host and still does not open a socket.
- Commands the client writes are built from validated arguments, not from a model command string: `LIST "" "*"`, `CREATE`, `RENAME`, `DELETE`, `UID MOVE`, `UID COPY`, `UID STORE` `+FLAGS` / `-FLAGS` for `\Seen` and `\Flagged` only, and `UID FETCH` with `BODY.PEEK` so a read or an attachment download does not change `\Seen`.
- Fetch summaries include the To header. Fetch of one message parses MIME in this module: first non-attachment `text/plain` is `textBody` (empty string when absent), first non-attachment `text/html` is `htmlBody` (empty string when absent), and every other body part is an attachment in encounter order. `index` starts at 0. `name` comes from the filename or name parameter, or is empty. `contentType` is the media type without parameters, or `application/octet-stream`. `size` is the decoded byte length. `get_attachment` uses that same parse and returns standard base64 (RFC 4648, with padding) of the decoded bytes. There is no size cap.
- Both connectors keep `tlsSession` to their own host (`imap.gmail.com:993` or `imap.mail.ru:993`) and call this client. They do not copy `imap.ts`.

**Alternative (rejected):** a second IMAP parser inside either connector — rejected; the proposal forbids a second stack.

**Alternative (rejected):** a connector factory that merges the Gmail and Mail.ru modules — rejected; this change shares protocol only. Each module still owns its id, hosts, fields, check, and tool list.

### 2. Sort in the process by the Date header, then cut; do not cap

- Load summaries for the full matching UID set, sort, then slice. Do not slice UIDs before the sort. UID order is not date order.
- Parse with `Date.parse`. A date that does not parse sorts as older than every date that does.
- Equal parsed dates: `newest` puts the higher uid first; `oldest` puts the lower uid first.
- Page math lives in one shared function both handlers call. Omitted, non-integer, or negative offset becomes 0. Omitted, non-integer, or limit below 1 becomes a null applied limit and returns the remainder from that offset. An integer limit greater than or equal to 1 is that limit, with no maximum and no clamp to the remainder. Omitted order is `newest`. Any other order throws `Invalid order` before SEARCH.
- Remove `GMAIL_LIST_DEFAULT_LIMIT`, `GMAIL_LIST_MAX_LIMIT`, and the Mail.ru equivalents. Do not re-export a default of 20 or a cap of 50.
- The envelope is `{ messages, total, offset, limit }` with the applied offset and the applied limit (`null` when the full remainder was returned). Each message has `uid`, `from`, `to`, `subject`, `date`, `seen`, and `unread` (`unread` is the opposite of `seen`). No body. `to` is the To header, or an empty string when it is absent.
- `search` still uses `assertNotFreeFormSearch` and `buildImapSearchCriteria`. Paging runs on the filtered summaries. `total` is the match count.

**Alternative (rejected):** keep the cap of 50 — rejected; the accepted revision removes it.

**Alternative (rejected):** IMAP SORT — rejected; the fake server would need a new extension, and the sort key would no longer be the date string the tool already returns.

**Alternative (rejected):** page by UID, then sort the page — rejected; the delta sorts the matching set before the cut.

### 3. Special use comes only from LIST attributes

- `listMailboxes` returns each listed name once, with `specialUse` derived only from LIST attributes. Map `\Inbox`, `\Sent`, `\Drafts`, `\Junk`, `\Trash`, `\Archive`, `\Flagged`, and `\All` to `inbox`, `sent`, `drafts`, `junk`, `trash`, `archive`, `flagged`, and `all`. Any other mailbox is `none`. When several of those attributes are present, the first match in that order wins.
- The tool result is a JSON array of `{ name, specialUse }`. No host property.
- Sent, Drafts, Spam, and Trash are the mailboxes whose `specialUse` is `sent`, `drafts`, `junk`, and `trash`. Callers pass that `name` as `mailbox`. Do not hardcode `[Gmail]/Trash`, `[Gmail]/Sent`, or Mail.ru folder names.
- The name `INBOX` is compared case-insensitively, in addition to `specialUse` `inbox`, for the rename and delete guards.

**Alternative (rejected):** a table of Gmail and Mail.ru folder names — rejected; the proposal forbids hard-coded provider names.

### 4. Folder and message writes

- `createMailbox` rejects a name that is empty or only whitespace with `Mailbox name is required` and does not send CREATE. Success JSON is `{ name }`.
- `renameMailbox` uses the same empty check on `name` and on `newName`, and does not send RENAME. If the source `specialUse` is `inbox` or the name is INBOX, throw `Inbox cannot be renamed` and do not send RENAME. Success JSON is `{ name, newName }`.
- `deleteMailbox` rejects an empty or whitespace name with `Mailbox name is required`. The same inbox guard throws `Inbox cannot be deleted` and does not send DELETE. Otherwise send IMAP DELETE. Do not EXPUNGE and do not move messages first. Success JSON is `{ name }`.
- `moveMessage` and `copyMessage` check LIST names first. If the destination is absent, throw `Destination mailbox does not exist` and do not send MOVE or COPY. A uid that is missing, not an integer, or below 1 throws `uid is required` and does not send the command. COPY leaves the source message in place. Success JSON is `{ uid, source, destination }` using the source uid. The destination uid may differ. Tests identify the copied or moved message by subject and from.
- `deleteMessage` finds the mailbox whose `specialUse` is `trash` (the first listed when several match). If none exists, throw `Trash mailbox is not available` and leave the message. Otherwise UID MOVE into that name. Do not STORE `\Deleted` and do not EXPUNGE. Success uses the trash name as `destination`.
- `restoreMessage` uses that same trash mailbox as the source. The destination defaults to `INBOX` when omitted, empty, or whitespace. A missing destination throws `Destination mailbox does not exist` and the message stays in trash. A missing trash mailbox throws `Trash mailbox is not available`.
- `updateFlags` requires at least one boolean `seen` or `flagged`. If neither property is a boolean, throw `Flag is required` and do not send STORE. True sends `+FLAGS`, false sends `-FLAGS`, omitted is left out of both. Do not send a STORE that replaces the full flag set. Success JSON is `{ uid, seen, flagged }` read after the store.
- A uid that is an integer greater than or equal to 1 and is not in the selected mailbox throws `Message not found` and does not change flags, folders, or message location.
- An attachment index that is missing, not an integer, or below 0 throws `Attachment index is required` and does not fetch. An integer index greater than or equal to 0 that does not match a part throws `Attachment not found`.
- Mailbox names are quoted by the client. The model never passes a raw IMAP command.

**Alternative (rejected):** COPY plus `\Deleted` for move — rejected; move is UID MOVE. Copy is its own tool.

**Alternative (rejected):** `\Deleted` plus EXPUNGE for delete — rejected; delete is a move into the listed trash mailbox, and restore moves it back.

**Alternative (rejected):** create the destination when it is missing — rejected; the delta says the tool fails and the message stays.

### 5. Accounts stay on the injected argument

- The gateway already adds `account` to native tool schemas and selects the account before the handler runs. This change does not add a tool that lists or switches accounts, and it does not edit the connector contract.

**Alternative (rejected):** an account-selection tool on Gmail or Mail.ru — rejected; the proposal keeps the existing argument.

### 6. Errors and the password

- English error texts above are the thrown messages. Tool descriptions stay English and do not include a URL, a host, or a secret. Schemas set `additionalProperties: false` and do not declare host, URL, secret, or command fields.
- Do not replace a MOVE, COPY, STORE, DELETE, or attachment FETCH `NO`/`BAD` with a new string that might be built from the password. Leave the server line as the error, as `runTagged` already does for non-LOGIN commands. `scrubSecretsInText` removes the fixture password. LOGIN and the admin connection check stay on their fixed messages.
- The password scenarios configure the fake so the MOVE, COPY, STORE, mailbox DELETE, or attachment FETCH `NO` text contains the fixture password. Each goes through the real handler, not a stubbed tool. The existing list password scenario stays.

### 7. Fake IMAP stays in-process

- Extend `server/test/connectors/mail/fake-imap.ts`. The default mailbox map is `INBOX` with the `\Inbox` attribute, filled from `options.messages`, so existing SEARCH and FETCH tests still select INBOX.
- Add LIST with attributes, CREATE, RENAME, DELETE, UID COPY, UID MOVE, and UID STORE of `\Seen` and `\Flagged`. SELECT of a name that is not in the map fails and does not create a mailbox. CREATE adds an empty mailbox with `specialUse` `none`. UID MOVE removes the uid from the selected mailbox and appends the message to the destination (a new uid is allowed). UID COPY appends a copy and leaves the source uid in place. DELETE removes the mailbox and does not move its messages. STORE changes only the flags the command names.
- Messages may carry an HTML body and attachment parts (`name`, `contentType`, decoded bytes).
- A test option makes MOVE, COPY, STORE, DELETE, or the attachment FETCH reply `NO` with a caller-supplied line and not change state. That line is how the password-scrub scenarios inject the fixture secret.
- No TCP listener, no DNS, no live Gmail or Mail.ru.

### 8. Existing tool tests follow the modified scenarios

- Tests that parse `list_messages` or `search_messages` as a bare array, or that expect a default of 20 or a cap of 50, change because the requirement changed. The scenario title `List returns capped summaries without bodies on a fake IMAP server` stays. Its expected result is the uncapped envelope: `limit` 80 on 60 equal-date messages returns 60 messages, uids 60 down to 1, not a page of 50 ending at uid 11. Keep the checks that the result has no body and no fixture password, and that search still rejects a free-form string before a SEARCH is written.
- Do not delete or weaken those assertions to match today's array or today's cap. The new scenarios are the expected values.
- The scenario title `Read returns headers and text body without attachment bytes` stays. That result gains `htmlBody` and `attachments` and still excludes attachment bytes and the password.

## Risks / Trade-offs

- [Every matching summary is fetched before the page is cut, and an omitted limit returns the whole remainder] → Accepted. There is no gateway cap. A later change can narrow the fetch. This change does not add IMAP SORT.
- [Attachment `data` can be large] → Accepted. There is no size cap. `data` is only on `get_attachment`, not on `read_message` or on list results.
- [Equal dates need a uid tie-break or the page is unstable] → Locked: higher uid is newer. With 60 equal dates and a limit of 80, `newest` returns uids 60 down to 1.
- [A destination uid differs from the source uid] → Success is the source uid, and the destination summary carries the same subject and from. The source uid remains after COPY and is gone after MOVE.
- [Trash and Sent names differ by provider] → Locked: use LIST attributes only. A fixture named `Deleted Items` with `\Trash` is the trash mailbox.
- [SELECT of an unknown name used to succeed on the fake] → No current test passes a mailbox other than the default. After this change, unknown SELECT fails. INBOX still exists.
- [Breaking JSON shape for list and search, and a larger default result] → Callers read `messages`. `limit` null means the remainder was returned. No stored document changes.
- [Duplicated tool schemas on the two connectors] → Accepted. Shared helpers own the protocol so the schemas cannot drift in behavior.

## Migration Plan

- No store migration and no admin UI change. Restart picks up the new tools. Removing the cap changes list and search results for existing clients.
- Rollback is reverting the pull request. Accounts and bearers stay.

## Open Questions

None. Locked here, and already in the delta specs where the behavior is visible: no default page and no cap of 50, `limit` null for the full remainder, date sort before the cut, uid tie-break, unparseable dates sorting as oldest, summary fields including `to`, `htmlBody` and attachment metadata, standard base64 with no size cap, special-use from LIST attributes only, inbox guards, trash move and restore, flag store, exact English errors, and fake-only tests.
