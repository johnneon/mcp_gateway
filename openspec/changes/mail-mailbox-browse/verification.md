# mail-mailbox-browse

## Result
blockers: 0

## Spec
- Gmail list_messages tool: met
- Gmail search_messages tool: met
- Gmail read_message tool: met
- Password never appears in Gmail tool or admin surfaces: met
- Gmail list_mailboxes tool: met
- Gmail create_mailbox tool: met
- Gmail rename_mailbox tool: met
- Gmail delete_mailbox tool: met
- Gmail move_message tool: met
- Gmail copy_message tool: met
- Gmail delete_message tool: met
- Gmail restore_message tool: met
- Gmail update_flags tool: met
- Gmail get_attachment tool: met
- Mail.ru list_messages tool: met
- Mail.ru search_messages tool: met
- Mail.ru read_message tool: met
- Password never appears in Mail.ru tool or admin surfaces: met
- Mail.ru list_mailboxes tool: met
- Mail.ru create_mailbox tool: met
- Mail.ru rename_mailbox tool: met
- Mail.ru delete_mailbox tool: met
- Mail.ru move_message tool: met
- Mail.ru copy_message tool: met
- Mail.ru delete_message tool: met
- Mail.ru restore_message tool: met
- Mail.ru update_flags tool: met
- Mail.ru get_attachment tool: met

## Checks
- tests: passed — 374 server + 45 web (419 total). All 17 tasks are checked. Each delta scenario name is a Vitest `it` title in `gmail-tools.test.ts` and `mailru-tools.test.ts` (53 each).
- type check: passed
- lint: passed
- format check: passed
- build: passed

## Review
- note: `git diff origin/main...HEAD` does not touch `mcp-gateway-spec.md`, `openspec/specs/`, or `web/`. Hosts stay `imap.gmail.com` and `imap.mail.ru`. One `createImapClient`. Tool schemas have no host, URL, secret, or command field. `NO` lines are `ToolFailure` and `scrubSecretsInText` runs before the MCP error.
- note: browser console shows `favicon.ico` 404 on the admin page. Unrelated to this delta.

## E2E
- Default call returns the full newest set inside an envelope: passed — `gmail_list_messages` and `mailru_list_messages` each returned 21 summaries, offset 0, limit null, total 21; first uid 1 seen; last uid 2 unseen; no body; password absent (`e2e/mcp-client.mjs`)
- Offset and both orders page a mailbox: passed — newest pages 5 then 7, then 8 then 6; oldest pages 6 then 8, then 7 then 5; `to` present
- List returns capped summaries without bodies on a fake IMAP server: passed — limit 80 returned 60 messages, uid 60 down to 1, no body
- Provided limit is honored with no maximum: passed — oldest limit 2 returned uids 1 then 2
- Unparseable dates sort as oldest: passed — newest uids 2, 3, 1; oldest uids 1, 3, 2; limit null
- Invalid offset and limit return the full remainder: passed — limit 0 and limit 1.5 both applied offset 0 and limit null
- Offset past the end returns an empty page: passed — offset 5 with limit 20 and with no limit both returned an empty `messages` array and total 1
- Unknown order is rejected: passed — error contained `Invalid order`; fake SEARCH count stayed 0
- Sent, Drafts, Spam, and Trash are listed by server mailbox name: passed — `Sent Items`, `Drafts`, `Spam`, `Deleted Items`; subjects matched; result did not contain `[Gmail]/`
- Narrow filter search returns matching summaries on a fake IMAP server: passed — filter from `alice@example.test` returned one alice summary, limit null
- Search applies paging and order after the filter: passed — oldest page uids 3 then 4; newest remainder uid 3; bob excluded
- Unknown search order is rejected: passed — `Invalid order`; SEARCH not issued
- Free-form IMAP search syntax is rejected: passed — a string filter and filter key `raw` failed; no new SEARCH
- Read returns headers and text body without attachment bytes: passed — `htmlBody` `<p>Readable html</p>`; attachment metadata only; `file-bytes` and `attachmentNames` absent
- Missing HTML part yields an empty string: passed — `textBody` `Plain only`, `htmlBody` empty string, `attachments` empty
- Attachment is returned as base64: passed — `data` `ZmlsZS1ieXRlcw==`, size 10, name `file.bin`
- Missing attachment is not found: passed — error contained `Attachment not found`
- Attachment index below 0 is rejected: passed — error contained `Attachment index is required`
- Get attachment uid below 1 is rejected: passed — error contained `uid is required`
- Set seen and flagged: passed — result `seen` true and `flagged` true
- Clear seen and flagged: passed — result `seen` false and `flagged` false
- Omitted flag stays unchanged: passed — setting `flagged` left `seen` true; then clearing `seen` left `flagged` true
- Flag is required: passed — omitted flags failed with `Flag is required`; a later `seen` true left `flagged` false
- Update flags uid below 1 is rejected: passed — error contained `uid is required`
- List mailboxes returns name and special use: passed — nine names once each; Gmail result had no `imap.gmail.com`; Mail.ru result had no `imap.mail.ru`; no `[Gmail]/`
- Create mailbox adds a folder: passed — `{ name: Projects }`; following list had `specialUse` `none`
- Empty mailbox name is rejected: passed — `""` and whitespace failed with `Mailbox name is required`
- Rename mailbox changes the folder name: passed — `Projects` became `Archive`; `Keep me` listed on `Archive`
- Empty rename is rejected: passed — empty name and whitespace `newName` failed; `Projects` stayed
- Inbox cannot be renamed: passed — `INBOX`, `inbox`, and `Incoming` failed with `Inbox cannot be renamed`
- Delete mailbox removes the folder: passed — `Projects` removed; trash did not gain `Gone with the folder`
- Empty delete name is rejected: passed — empty and whitespace failed; `INBOX` stayed
- Inbox cannot be deleted: passed — `INBOX`, `inbox`, and `Incoming` failed with `Inbox cannot be deleted`
- Server refusal leaves the mailbox: passed — DELETE `NO` omitted the fixture password; `Projects` stayed
- Move message into an existing mailbox: passed — uid 7, source `INBOX`, destination `Archive`; subject `Move me` left `INBOX`
- Missing destination leaves the message in the source: passed — `Destination mailbox does not exist`; uid 7 stayed in `INBOX`
- Move uid below 1 is rejected: passed — `uid is required`; uid 7 stayed
- Copy message keeps the source: passed — source uid 7 stayed; `Archive` gained `Copy me`
- Copy missing destination does not copy: passed — `Destination mailbox does not exist`; uid 7 stayed
- Copy uid below 1 is rejected: passed — `uid is required`; uid 7 stayed
- Delete message moves it into trash: passed — destination `Deleted Items`; uid 7 left `INBOX`; no `[Gmail]/`
- Missing trash leaves the message in place: passed — `Trash mailbox is not available`; uid 7 stayed
- Delete message uid below 1 is rejected: passed — `uid is required`; uid 7 stayed
- Restore message moves it out of trash: passed — source `Deleted Items`, destination `INBOX`; subject `Restore me` left trash
- Restore without a trash mailbox is rejected: passed — `Trash mailbox is not available`
- Restore missing destination leaves the message in trash: passed — `Destination mailbox does not exist`; `Stay deleted` stayed in `Deleted Items`
- Restore uid below 1 is rejected: passed — `uid is required`; uid 9 stayed in `Deleted Items`
- Fixture password absent from tool result and MCP error: passed — list success and a handler throw that included the fixture secret; MCP text omitted it
- Fixture password absent from move_message failure: passed — `NO` scrubbed; message stayed in the source
- Fixture password absent from copy_message failure: passed — `NO` scrubbed; destination did not gain the message
- Fixture password absent from update_flags failure: passed — `NO` scrubbed; message stayed unseen and not flagged
- Fixture password absent from delete_mailbox failure: passed — `NO` scrubbed; `Projects` stayed
- Fixture password absent from get_attachment failure: passed — `NO` scrubbed; error was not an attachment object
- Foreign and disabled account: passed — `list_messages` rejected both; fake TLS session count stayed unchanged
- tools/list exposes mailbox tools: passed — 13 `gmail_*` and 13 `mailru_*` tools; schemas had no host, URL, secret, password, or command
- Empty and unknown bearer identical rejection: passed — both 401 with the same body; fixture password absent
- MCP vs admin port separation: passed — admin `/mcp` 404; MCP `/api/connectors` 404
- Admin configurations empty state: passed — heading `Configurations`; text `No configurations yet. Create one to get a bearer token.`; Create disabled
- Admin connectors list: passed — `Gmail inbox` showed `address: user@gmail.com`; `Mail.ru inbox` showed `address: user@mail.ru`; no password on screen
- Admin edit dialog: passed — `Edit account` said `Secret fields stay blank on edit to keep the stored value.`; App password input value was empty; after Cancel the dialog was gone
- Admin connection check: passed — `POST /api/accounts/gmail-e2e-1/check` and `POST /api/accounts/mailru-e2e-1/check` both 200 body `{"ok":true}`
- Admin API create, list, and failed check: passed — create 201 and list omitted the fixture password; a wrong Mail.ru password returned exactly `Connection check failed` and did not save

No live Gmail or Mail.ru host was contacted. The fake IMAP duplex from this change backed every tool call.

## Leaks
- admin UI DOM on Configurations and Connectors: clean
- admin edit dialog input values, including App password: clean
- admin UI DOM after Cancel: clean
- admin API accounts list, connectors list, create, and check: clean
- MCP tools/list and tools/call results: clean
- MCP error text, including `NO` lines that contained the fixture password: clean
- browser console (aside from favicon 404): clean
