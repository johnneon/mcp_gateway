# Proposal

Issue: #44

## Why

Gmail and Mail.ru can list, search, and read a message, but the model cannot work a mailbox. List results are a bare array of the newest UIDs, capped at 50 with a default page of 20, with no date order and no recipient. There is no HTML body, no attachment download, no flag change, no copy, no folder rename or delete, and no way to move mail into or out of the trash folder the server actually lists. Both connectors need that mailbox behavior once, in the shared IMAP module, over the egress duplex only.

## What Changes

- **BREAKING** `list_messages` and `search_messages` on both connectors (`gmail_list_messages`, `gmail_search_messages`, `mailru_list_messages`, `mailru_search_messages`). Optional `offset` defaults to 0. Optional `order` is `newest` or `oldest`, default `newest`. The handler sorts the matching set by the Date header before the cut. Unparseable dates sort as oldest. Equal dates break by uid as designed: `newest` puts the higher uid first, `oldest` puts the lower uid first. The gateway cap of 50 and the default page of 20 are removed. IMAP has no 50-message limit. When `limit` is omitted, is not an integer, or is below 1, the call returns the entire matching set from that offset and the envelope `limit` is null. A provided integer `limit` greater than or equal to 1 is honored with no maximum. The result is `{ messages, total, offset, limit }`, not a bare array. Each summary has `uid`, `from`, `to`, `subject`, `date`, `seen`, and `unread`, and has no body.
- `search_messages` keeps the narrow filter (`unseen`, `from`, `subject`, `since`) and still rejects a free-form IMAP search string or any other filter key. The shared module turns that filter into IMAP SEARCH. Paging and order run after the filter. `total` is the match count.
- **BREAKING** `read_message` keeps `textBody` and `to`, and adds `htmlBody` (empty string when there is no text/html part) and `attachments`: an array of `{ index, name, contentType, size }` with no bytes.
- Add `get_attachment`. Required uid greater than or equal to 1, optional mailbox default `INBOX`, required integer index greater than or equal to 0. The result is `{ index, name, contentType, size, data }` where `data` is standard base64 of that MIME part. There is no size cap. A missing part throws `Attachment not found`.
- Add `update_flags`. Required uid greater than or equal to 1, optional mailbox default `INBOX`, optional boolean `seen`, optional boolean `flagged`. At least one of `seen` or `flagged` is required. If both are omitted the tool throws `Flag is required` and does not send STORE. True adds the flag, false removes it, and omitted leaves it. `seen` is IMAP `\Seen`. `flagged` is IMAP `\Flagged`. Other flags stay. Success is `{ uid, seen, flagged }` after the store.
- Add `list_mailboxes`. The result is a JSON array of `{ name, specialUse }`. `specialUse` comes only from LIST attributes: `\Inbox` to `inbox`, `\Sent` to `sent`, `\Drafts` to `drafts`, `\Junk` to `junk`, `\Trash` to `trash`, `\Archive` to `archive`, `\Flagged` to `flagged`, `\All` to `all`, otherwise `none`. No host in the result. Sent, Drafts, Spam, and Trash are found this way. Provider folder names are not hardcoded.
- `create_mailbox` takes a required name. Empty or whitespace throws `Mailbox name is required` and does not send CREATE. Success is `{ name }`.
- Add `rename_mailbox`. Required `name` and `newName`. Empty or whitespace on either throws `Mailbox name is required` and does not send RENAME. Renaming the mailbox whose `specialUse` is `inbox`, or the name INBOX, throws `Inbox cannot be renamed` and does not send RENAME. Success is `{ name, newName }`.
- Add `delete_mailbox`. Required name. Empty throws `Mailbox name is required`. Deleting inbox (`specialUse` `inbox` or the name INBOX) throws `Inbox cannot be deleted` and does not send DELETE. Otherwise the tool sends IMAP DELETE. It does not expunge and does not move messages first. If the server replies NO, the mailbox stays and the error text is scrubbed. Success is `{ name }`.
- `move_message` keeps uid, optional source mailbox default `INBOX`, and a required destination that must already exist. A missing destination throws `Destination mailbox does not exist` and does not send MOVE. A uid below 1 throws `uid is required`. Success is `{ uid, source, destination }`.
- Add `copy_message` with the same arguments. It sends UID COPY. A missing destination throws the same error and does not send COPY. The source message stays. Success is `{ uid, source, destination }`.
- Add `delete_message`. Required uid, optional mailbox default `INBOX`. It MOVEs the message into the mailbox whose `specialUse` is `trash`. It does not set `\Deleted` and does not EXPUNGE. If LIST has no trash mailbox, it throws `Trash mailbox is not available` and leaves the message. Success is `{ uid, source, destination }` with `destination` the trash name.
- Add `restore_message`. Required uid, optional destination default `INBOX`. The source is the trash mailbox. If there is no trash mailbox, it throws `Trash mailbox is not available`. If the destination does not exist, it throws `Destination mailbox does not exist` and the message stays in trash. Success is `{ uid, source, destination }`.
- Several accounts of one connector stay the existing gateway `account` argument. This change does not add an account-selection tool and does not change the connector contract.
- Protocol work lands in `server/src/connectors/mail/imap.ts` over the egress duplex only. Neither connector gains a second IMAP stack.
- Model arguments contain no URL, host, secret, or raw IMAP command string. Tool names, descriptions, and error text stay English. Tests use a fake IMAP server and do not contact a live mailbox. The account password does not appear in results or errors. A fake NO line that contains the fixture password on MOVE, COPY, STORE, DELETE mailbox, and `get_attachment` failure must not appear in the MCP error text. The existing list password scenario stays.

When the product vision and this accepted approach differ, this approach wins for the duration of the change.

## Non-goals

- Sending mail. The interaction table does not include send.
- Free-form IMAP search, or a raw IMAP command string in model arguments.
- EXPUNGE or `\Deleted` as a product tool.
- A second IMAP stack.
- OAuth.
- An admin UI change.
- A live Gmail or Mail.ru mailbox in tests.
- Edits to `mcp-gateway-spec.md` or `openspec/specs/` during apply.
- Hard-coded provider folder names, including Gmail `[Gmail]/Trash` and Mail.ru folder names.
- A new account-selection tool, or a change to the connector contract for choosing an account.

## Capabilities

### New Capabilities

- (none)

### Modified Capabilities

- `connector-gmail`: Remove the list cap and default page. Page and date-order `list_messages` and `search_messages` with `to` on each summary. Extend `read_message` with HTML and attachment metadata. Add `get_attachment`, `update_flags`, `list_mailboxes`, `create_mailbox`, `rename_mailbox`, `delete_mailbox`, `move_message`, `copy_message`, `delete_message`, and `restore_message`. Extend password scrubbing to a failed MOVE, COPY, STORE, mailbox DELETE, and attachment fetch whose fake IMAP error includes the fixture password.
- `connector-mail-ru`: The same tool changes, with MCP names `mailru_*` and the Mail.ru hosts unchanged.

## Impact

- `server/src/connectors/mail/imap.ts` and `server/src/connectors/mail/types.ts`: date sort, uncapped page, LIST attributes, CREATE, RENAME, DELETE, UID MOVE, UID COPY, UID STORE for `\Seen` and `\Flagged`, MIME text, HTML, and attachment parts, on the existing duplex client. The list default of 20 and the cap of 50 leave this module.
- `server/src/connectors/gmail/index.ts` and `server/src/connectors/mailru/index.ts`: tool schemas and handlers call that module. Hosts, fields, connection check, and the injected `account` argument stay.
- `server/test/connectors/mail/fake-imap.ts`: folders, LIST attributes, CREATE, RENAME, DELETE, COPY, STORE, MOVE, and MIME parts. Existing single-mailbox SEARCH and FETCH stay usable.
- Tool tests under `server/test/connectors/gmail/` and `server/test/connectors/mailru/`. No `web/` change. No live mailbox. No `connector-contract` change.
