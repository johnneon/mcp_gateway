# Design

## Context

See proposal.md for why summary fetch must be split. `fetchSummaries` in `server/src/connectors/mail/imap.ts` joins every UID with commas and sends one `UID FETCH ${set} (FLAGS BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE)])` through `runTagged`. `pageMessages` searches, fetches those summaries, sorts by date, and then cuts the page. Mail.ru and Gmail `list_messages` and `search_messages` both call `pageMessages`. `fetchMessage` and the flag read already fetch one UID. The fake IMAP server records each command without the tag and answers any comma-separated `UID FETCH`.

## Goals / Non-Goals

**Goals:**

- Keep each summary `UID FETCH` at or under 4096 UTF-8 bytes of command text, excluding the tag and the line ending.
- Return the same envelope after the same sort and page, including when the page is smaller than the matched set.
- Prove it with a fake that ends the connection on one overlong `UID FETCH`, for both connectors, including a filtered UID set that is not `1:*`.

**Non-Goals:**

- See proposal.md. This design does not change single-UID reads, SMTP, or the connection check.

## Decisions

### Byte budget of 4096, not a fixed UID count

Mail.ru accepted a command of about 8 KB (1500 UIDs) and dropped the connection at about 18 KB (3222 UIDs). The threshold between those sizes is unknown. A count of 1500 is not safe for wider UIDs: 1500 ten-digit UIDs plus commas are about 16 KB. The budget is the UTF-8 length of the command string passed to `runTagged`. That is the text the fake stores, without the tag or the line ending.

4096 is half of 8192 and stays under the accepted size. The fixed text around the UID list is 66 bytes for the current summary items, so one UID always fits. An IMAP UID is at most 10 digits.

Alternative considered: a budget of 8192. Rejected. "About 8 KB" may already sit near the failure, and the accepted outcome asks for a budget safely under the size Mail.ru accepted.

Alternative considered: cap the UID count at 1500. Rejected. The same count with wider UIDs can exceed the size that failed.

### Greedy split in search order, explicit UIDs only

Walk the UID list `search` already returned. Build each command as `UID FETCH`, a comma-separated UID list, and ` (FLAGS BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE)])`. Append the next UID when the resulting UTF-8 length is at most 4096. Otherwise send the current command and start another. Send the commands in that order on the same selected client. Concatenate the parsed fetches. Leave the `pageMessages` sort and paging as they are.

An empty list sends no command. A list that fits in 4096 bytes is one command. A failed batch, or a connection that closes, fails the tool call. Do not return a partial envelope.

Do not emit `1:*` or a UID range. `UID FETCH 1:3222` is short and Mail.ru accepts it, and a range would include UIDs the filter did not match.

Alternative considered: `UID FETCH 1:*` when SEARCH returned every UID. Rejected. Filtered search still needs specific UIDs, and the accepted outcome is one mechanism for the matched set.

Alternative considered: fetch only the UIDs on the page. Rejected. The date sort needs every matched summary before the cut. The paged half of each new scenario still requires the batches to name the whole matched set.

### Fake closes instead of answering an overlong FETCH

Add optional `maxUidFetchCommandBytes` on the fake IMAP options. When a `UID FETCH` command's recorded text is longer than that limit, end the duplex without `OK`, in the same shape as a dropped TLS session. Existing tests leave the option unset. The new scenarios set it to 4096.

Expose the recorded IMAP command texts from the Mail.ru and Gmail fake egress transports. The duplex already keeps them. The tool-test helpers accept the new option.

The scenario fixtures are large enough that the comma-separated UID list alone exceeds 4096 bytes, measured with the current summary command:

- UIDs 1 through 1100: command 4458 bytes; the list alone is 4392 bytes.
- Alice UIDs `1000000001 + 2 * i` for `i` from 0 through 399: command 4465 bytes; the list alone is 4399 bytes. Bob occupies the neighboring UIDs, so the match is not a range and is not `1:*`.

No live mailbox. No new hosts, fields, or model arguments. Hosts stay in connector code. Secrets stay in the process.

## Risks / Trade-offs

- [4096 bytes uses more round trips than a budget closer to 8 KB] → Accepted. The gap between the known success and the known failure is unmeasured, so the margin stays. Raising the constant later does not change the envelope.
- [Gmail's command limit is unmeasured] → The same batches stay at or under a size Mail.ru accepted. A smaller command still succeeds if Gmail allows a larger one.
- [A dropped connection on a later batch fails the whole call] → Accepted. A partial page would look like a complete result. The tool error stays the existing failure path.

## Migration Plan

No store migration and no environment change. Rollback is restoring the single `UID FETCH` in `fetchSummaries`.

## Open Questions

None. The budget is 4096 bytes, the split is explicit UIDs in search order, and both connectors share `fetchSummaries`.
