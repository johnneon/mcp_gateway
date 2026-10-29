# Proposal

Issue: #54

## Why

`list_messages` and `search_messages` load every matching UID and then ask the shared IMAP client for summaries in one `UID FETCH`. On a live Mail.ru INBOX of 3222 messages that command is about 18 KB. Mail.ru drops the TLS connection, and the MCP call ends as `Tool execution failed` instead of the summary envelope. A batch of 1500 UIDs (about 8 KB) succeeds on that mailbox, and `UID FETCH 1:*` also returns all 3222, but a filtered search still needs the specific matched UIDs. Gmail uses the same client.

## What Changes

- Summary fetch splits the matched UID set into `UID FETCH` commands of specific UIDs. Each command stays within a 4096-byte budget, under the about 8 KB command Mail.ru accepted.
- Mail.ru and Gmail `list_messages` and `search_messages` keep the JSON envelope `{ messages, total, offset, limit }`, the same date sort, and the same paging rules. The handler still fetches every matched summary before the sort and the cut.
- A fake IMAP server closes the connection on one overlong `UID FETCH`. The tools still return every matching summary. Automated tests do not contact a live mailbox.
- A set that fits in one command stays one command. An empty match issues no `UID FETCH`.

## Non-goals

- Changing the envelope shape, the date sort, or the paging rules.
- SMTP, the connection check, or sending mail.
- Reading a single message by uid. That path already fetches one UID.
- Treating `UID FETCH 1:*` as the fix, including as a special case only when the match is the whole mailbox.
- Live-provider tests.
- Secrets in artifacts or the issue.
- Edits to `mcp-gateway-spec.md` or files under `openspec/specs/` during apply.

## Capabilities

### New Capabilities

### Modified Capabilities

- `connector-mail-ru`: `list_messages` and `search_messages` fetch summaries with batched `UID FETCH` commands of at most 4096 bytes and still return the current envelope, sort, and page.
- `connector-gmail`: the same summary-fetch behavior on `list_messages` and `search_messages`, through the shared IMAP client.

## Impact

- `server/src/connectors/mail/imap.ts`: `fetchSummaries` splits the matched UID list. `pageMessages` keeps sort and paging. Single-UID fetch, store, and search criteria stay.
- `server/test/connectors/mail/fake-imap.ts`: an optional limit closes the duplex when one `UID FETCH` exceeds it. Existing tests leave the limit unset.
- Mail.ru and Gmail fake egress wrappers expose the recorded IMAP commands so the new scenarios can assert batch size and the matched UID set.
- No admin UI, store, host, or model-argument change. Hosts stay in connector code. The model still does not receive a URL, a host, or a secret.
