# Proposal

Issue: #44

## Why

Gmail and Mail.ru can list, search, and read messages, but a client cannot walk a mailbox. `list_messages` returns the newest UIDs as a bare JSON array (optional mailbox, default `INBOX`; limit default 20, cap 50) and does not sort by date. `search_messages` returns every match with no cap. There is no offset, no order argument, and no folder tool. Both connectors need the same page, date order, folder list, folder create, and single-message move, implemented once in the shared IMAP module.

## What Changes

- **BREAKING** `list_messages` and `search_messages` on both connectors (`gmail_list_messages`, `gmail_search_messages`, `mailru_list_messages`, `mailru_search_messages`). Arguments add optional `offset` (integer, default 0), keep optional `mailbox` (default `INBOX`) and optional `limit` (integer, default 20, cap 50), and add optional `order` (`newest` or `oldest`, default `newest`). The handler sorts the matching set by message date, then cuts the page. Newest is highest date first. Oldest is lowest date first. The result is a JSON object `{ messages, total, offset, limit }`, not a bare array. Each message keeps `uid`, `from`, `subject`, `date`, and seen/unread, and has no body. A call with no offset and order `newest` still returns the first page of the newest messages, inside that envelope. `search_messages` no longer returns every match in one call.
- `search_messages` keeps the narrow filter (`unseen`, `from`, `subject`, `since`) and still rejects a free-form IMAP search string or any other filter key. Paging and order apply after the filter. `total` is the match count.
- Add `list_mailboxes`, `create_mailbox`, and `move_message` on both connectors (MCP names `gmail_*` and `mailru_*`). `list_mailboxes` returns the folder names the server lists and takes no host. `create_mailbox` takes a required name and rejects an empty name. `move_message` takes a required uid (integer >= 1), an optional source mailbox (default `INBOX`), and a required destination mailbox. The destination must already exist. If it does not, the tool fails and the message stays in the source. Error text does not contain the password.
- Protocol work lands in `server/src/connectors/mail/imap.ts` over the egress duplex only. Neither connector gains a second IMAP stack.
- Model arguments contain no URL, host, secret, or raw IMAP command string. Tool names, descriptions, and error text stay English. Tests use a fake IMAP server and do not contact a live mailbox. The account password does not appear in results or errors, including a `move_message` failure whose fake IMAP error includes the fixture password.
- Connection check, `read_message`, connector identity, and the existing password-scrub path stay. The password requirement gains a `move_message` failure scenario.

When the product vision and this accepted approach differ, this approach wins for the duration of the change.

## Non-goals

- Sending mail.
- Deleting a message as its own tool.
- Deleting or renaming a mailbox.
- Marking a message seen or unseen.
- Attachment bytes.
- Copy without move.
- Free-form IMAP search or a raw IMAP command string in model arguments.
- A second IMAP stack, a new connector, OAuth, or an admin UI change.
- A live Gmail or Mail.ru mailbox in tests.
- Edits to `mcp-gateway-spec.md` or `openspec/specs/` during apply.

## Capabilities

### New Capabilities

- (none)

### Modified Capabilities

- `connector-gmail`: Page and date-order `list_messages` and `search_messages` (envelope result, search cap). Add `list_mailboxes`, `create_mailbox`, and `move_message`. Add a password-scrub scenario for a failed `move_message` whose IMAP error includes the fixture password.
- `connector-mail-ru`: The same tool changes, with MCP names `mailru_*` and the Mail.ru hosts unchanged.

## Impact

- `server/src/connectors/mail/imap.ts` (and the shared mail types it exports): date sort, page, LIST, CREATE, and UID MOVE on the existing duplex client.
- `server/src/connectors/gmail/index.ts` and `server/src/connectors/mailru/index.ts`: tool schemas and handlers call that module. Hosts, fields, and connection check stay.
- `server/test/connectors/mail/fake-imap.ts`: folders, CREATE, and MOVE for tests. Existing single-mailbox SEARCH and FETCH stay usable.
- Tool tests under `server/test/connectors/gmail/` and `server/test/connectors/mailru/`. No `web/` change. No live mailbox.
