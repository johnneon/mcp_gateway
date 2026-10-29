# Spec Delta

## MODIFIED Requirements

### Requirement: Mail.ru list_messages tool

The Mail.ru connector SHALL declare a tool with short name `list_messages` (MCP name `mailru_list_messages`). Model arguments SHALL include an optional `mailbox` string that defaults to `INBOX` when omitted or empty, an optional `offset` integer, an optional `limit` integer, and an optional `order` string. When `offset` is omitted, is not an integer, or is less than 0, the applied offset SHALL be 0. When `limit` is omitted, is not an integer, or is less than 1, the tool SHALL return the entire matching set from the applied offset and the envelope `limit` SHALL be null. When `limit` is an integer greater than or equal to 1, the applied limit SHALL be that integer and SHALL have no maximum. When `order` is omitted, the applied order SHALL be `newest`. When `order` is present and is not `newest` or `oldest`, the tool SHALL fail with English error text that contains `Invalid order` and does not contain the account password, and SHALL NOT issue SEARCH. The handler SHALL load the mailbox, sort that set by parsed message date, and then cut. Before the sort and the cut, the handler SHALL fetch a summary for every UID in the matched set. When that set is non-empty, the handler SHALL request those summaries with one or more `UID FETCH` commands that name specific matched UIDs in a comma-separated list. The UTF-8 byte length of each such command, excluding the IMAP tag and the line ending, SHALL be at most 4096. The commands for one call together SHALL name each matched UID exactly once. The handler SHALL NOT request that set with `UID FETCH 1:*` and SHALL NOT replace the comma-separated UID list with a UID range. When one command naming every matched UID would exceed 4096 bytes, the handler SHALL use more than one command. When one command naming every matched UID is at most 4096 bytes, the handler SHALL issue that one command. When the matched set is empty, the handler SHALL NOT issue `UID FETCH`. `newest` SHALL place the highest date first. `oldest` SHALL place the lowest date first. A date that does not parse SHALL sort as older than every date that does. When two parsed dates are equal, `newest` SHALL place the higher uid first and `oldest` SHALL place the lower uid first. The same uid tie-break SHALL apply to two unparseable dates. The result SHALL be a JSON object `{ messages, total, offset, limit }`, not a JSON array. `total` SHALL be the size of the mailbox set before the cut. `offset` and `limit` in the object SHALL be the applied values. `messages` SHALL be the cut after the sort. When the applied offset is greater than or equal to `total`, `messages` SHALL be an empty array and `total` SHALL stay the full set size. Each message SHALL include `uid`, `from`, `to`, `subject`, `date`, `seen`, and `unread`, and SHALL NOT include a message body. `unread` SHALL be the boolean opposite of `seen`. `date` SHALL be the message date string. `to` SHALL be the To header, or an empty string when that header is absent. Passing `mailbox` SHALL select that folder, including a folder whose name came from `list_mailboxes`. The handler SHALL use the egress TLS session to the IMAP host only. Model arguments SHALL NOT contain a URL, a host, a secret, or a raw IMAP command string. Automated tests SHALL use a fake IMAP server and SHALL NOT contact a live mailbox.

#### Scenario: Default call returns the full newest set inside an envelope

- **GIVEN** an enabled configuration whose `accountIds` include an enabled Mail.ru account, and the MCP app with a fake egress transport backed by a fake IMAP server
- **AND** the plaintext bearer of that configuration is known to the test
- **AND** `INBOX` contains uids 1 through 21, each from `alice@example.test` and to `me@example.test`
- **AND** uid 1 is seen and has date `01 Feb 2024 00:00:00 +0000`
- **AND** each uid `n` from 2 through 21 is unseen and has date day `n-1` of January 2024 at `00:00:00 +0000`, so uid 2 is `01 Jan 2024 00:00:00 +0000` and uid 21 is `20 Jan 2024 00:00:00 +0000`
- **WHEN** an authenticated MCP client calls `mailru_list_messages` with no `mailbox`, no `offset`, no `limit`, and no `order`
- **THEN** the result text parses as a JSON object with `messages`, `total`, `offset`, and `limit`
- **AND** the parsed value is not an array
- **AND** `offset` is 0, `limit` is null, and `total` is 21
- **AND** `messages` has length 21
- **AND** `messages[0].uid` is 1, `messages[0].to` is `me@example.test`, `messages[0].seen` is true, and `messages[0].unread` is false
- **AND** the last message uid is 2, its `seen` is false, and its `unread` is true
- **AND** each message includes `uid`, `from`, `to`, `subject`, `date`, `seen`, and `unread`
- **AND** no message includes `textBody` or `htmlBody`
- **AND** the result text does not contain the account password

#### Scenario: Offset and both orders page a mailbox

- **GIVEN** an eligible Mail.ru account on an enabled configuration and a fake IMAP server whose `INBOX` contains uid 5 dated `04 Jan 2024 00:00:00 +0000`, uid 6 dated `01 Jan 2024 00:00:00 +0000`, uid 7 dated `03 Jan 2024 00:00:00 +0000`, and uid 8 dated `02 Jan 2024 00:00:00 +0000`
- **WHEN** an authenticated MCP client calls `mailru_list_messages` with `limit` 2, `offset` 0, and `order` `newest`
- **THEN** the envelope has `total` 4, `offset` 0, and `limit` 2
- **AND** `messages` uids are 5 then 7
- **WHEN** the client calls `mailru_list_messages` with `limit` 2, `offset` 2, and `order` `newest`
- **THEN** `messages` uids are 8 then 6
- **AND** `total` is 4
- **WHEN** the client calls `mailru_list_messages` with `limit` 2, `offset` 0, and `order` `oldest`
- **THEN** `messages` uids are 6 then 8
- **WHEN** the client calls `mailru_list_messages` with `limit` 2, `offset` 2, and `order` `oldest`
- **THEN** `messages` uids are 7 then 5
- **AND** each message includes `to`
- **AND** no message includes a message body
- **AND** the result text does not contain the account password

#### Scenario: List returns capped summaries without bodies on a fake IMAP server

- **GIVEN** an eligible Mail.ru account on an enabled configuration and a fake IMAP server that has 60 messages in `INBOX`, uids 1 through 60, every message dated `01 Jan 2024 00:00:00 +0000` and to `me@example.test`
- **WHEN** an authenticated MCP client calls `mailru_list_messages` with `limit` 80 and without `mailbox`
- **THEN** the envelope `limit` is 80, `offset` is 0, and `total` is 60
- **AND** `messages` has length 60
- **AND** `messages[0].uid` is 60
- **AND** the last message uid is 1
- **AND** each message includes `uid`, `from`, `to`, `subject`, `date`, `seen`, and `unread`
- **AND** no message includes a message body
- **AND** the result text does not contain the account password

#### Scenario: Provided limit is honored with no maximum

- **GIVEN** an eligible Mail.ru account on an enabled configuration and a fake IMAP server that has 60 messages in `INBOX`, uids 1 through 60, every message dated `01 Jan 2024 00:00:00 +0000`
- **WHEN** an authenticated MCP client calls `mailru_list_messages` with `limit` 2, `offset` 0, and `order` `oldest`
- **THEN** the envelope `limit` is 2, `offset` is 0, and `total` is 60
- **AND** `messages` uids are 1 then 2
- **AND** no message includes a message body
- **AND** the result text does not contain the account password

#### Scenario: Unparseable dates sort as oldest

- **GIVEN** an eligible Mail.ru account on an enabled configuration and a fake IMAP server whose `INBOX` contains uid 1 dated `not-a-date`, uid 2 dated `02 Jan 2024 00:00:00 +0000`, and uid 3 dated `not-a-date`
- **WHEN** an authenticated MCP client calls `mailru_list_messages` with `order` `newest` and no `limit`
- **THEN** `messages` uids are 2, then 3, then 1
- **AND** `limit` is null and `total` is 3
- **WHEN** the client calls `mailru_list_messages` with `order` `oldest` and no `limit`
- **THEN** `messages` uids are 1, then 3, then 2

#### Scenario: Invalid offset and limit return the full remainder

- **GIVEN** an eligible Mail.ru account on an enabled configuration and a fake IMAP server whose `INBOX` contains one message
- **WHEN** an authenticated MCP client calls `mailru_list_messages` with `limit` 0 and `offset` -1
- **THEN** the envelope `offset` is 0 and `limit` is null
- **AND** `total` is 1 and `messages` has length 1
- **WHEN** the client calls `mailru_list_messages` with `limit` 1.5 and `offset` -4
- **THEN** the envelope `offset` is 0 and `limit` is null
- **AND** `total` is 1 and `messages` has length 1

#### Scenario: Offset past the end returns an empty page

- **GIVEN** an eligible Mail.ru account on an enabled configuration and a fake IMAP server whose `INBOX` contains one message
- **WHEN** an authenticated MCP client calls `mailru_list_messages` with `offset` 5 and `limit` 20
- **THEN** the envelope `offset` is 5, `limit` is 20, and `total` is 1
- **AND** `messages` is an empty array
- **WHEN** the client calls `mailru_list_messages` with `offset` 5 and no `limit`
- **THEN** the envelope `offset` is 5, `limit` is null, and `total` is 1
- **AND** `messages` is an empty array

#### Scenario: Unknown order is rejected

- **GIVEN** an eligible Mail.ru account on an enabled configuration and a fake IMAP server
- **WHEN** an authenticated MCP client calls `mailru_list_messages` with `order` `random`
- **THEN** the tool call fails
- **AND** the error text contains `Invalid order`
- **AND** the error text does not contain the account password
- **AND** the fake IMAP server was not issued SEARCH

#### Scenario: Sent, Drafts, Spam, and Trash are listed by server mailbox name

- **GIVEN** an eligible Mail.ru account on an enabled configuration and a fake IMAP server
- **AND** `INBOX` has LIST attribute `\Inbox` and a message with subject `Inbox note`
- **AND** a mailbox named `Sent Items` has LIST attribute `\Sent` and a message with subject `Sent note`
- **AND** a mailbox named `Drafts` has LIST attribute `\Drafts` and a message with subject `Draft note`
- **AND** a mailbox named `Spam` has LIST attribute `\Junk` and a message with subject `Spam note`
- **AND** a mailbox named `Deleted Items` has LIST attribute `\Trash` and a message with subject `Trash note`
- **WHEN** an authenticated MCP client calls `mailru_list_mailboxes` and then `mailru_list_messages` with `mailbox` set to the listed name whose `specialUse` is `sent`
- **THEN** that name is `Sent Items`
- **AND** `messages` includes the subject `Sent note` and does not include `Inbox note`
- **AND** no message includes a message body
- **WHEN** the client calls `mailru_list_messages` with the listed name whose `specialUse` is `drafts`
- **THEN** `messages` includes the subject `Draft note`
- **WHEN** the client calls `mailru_list_messages` with the listed name whose `specialUse` is `junk`
- **THEN** `messages` includes the subject `Spam note`
- **WHEN** the client calls `mailru_list_messages` with the listed name whose `specialUse` is `trash`
- **THEN** `messages` includes the subject `Trash note`
- **AND** the result text does not contain the account password
- **AND** the result text does not contain `[Gmail]/`

#### Scenario: Large mailbox summary fetch stays within the command budget

- **GIVEN** an eligible Mail.ru account on an enabled configuration and a fake IMAP server
- **AND** the fake IMAP server ends the connection without completing the command when any one `UID FETCH` command exceeds 4096 UTF-8 bytes, excluding the IMAP tag and the line ending
- **AND** `INBOX` contains uids 1 through 1100, each from `alice@example.test` and to `me@example.test`
- **AND** uid 1100 has date `02 Feb 2024 00:00:00 +0000`
- **AND** uid 1099 has date `01 Feb 2024 00:00:00 +0000`
- **AND** every other uid has date `01 Jan 2024 00:00:00 +0000`
- **AND** a comma-separated list of uids 1 through 1100 is longer than 4096 UTF-8 bytes
- **WHEN** an authenticated MCP client calls `mailru_list_messages` with no `mailbox`, no `offset`, no `limit`, and `order` `newest`
- **THEN** the result text parses as a JSON object with `messages`, `total`, `offset`, and `limit`
- **AND** `offset` is 0, `limit` is null, and `total` is 1100
- **AND** `messages` has length 1100
- **AND** `messages[0].uid` is 1100, `messages[1].uid` is 1099, and `messages[2].uid` is 1098
- **AND** the last message uid is 1
- **AND** `messages` contains each uid from 1 through 1100 exactly once
- **AND** each message includes `uid`, `from`, `to`, `subject`, `date`, `seen`, and `unread`
- **AND** each message `to` is `me@example.test`
- **AND** no message includes a message body
- **AND** the call issued more than one `UID FETCH` command
- **AND** each of those commands is at most 4096 UTF-8 bytes, excluding the IMAP tag and the line ending
- **AND** those commands together name each uid from 1 through 1100 exactly once
- **AND** no `UID FETCH` command uses `1:*` or a UID range
- **AND** the result text does not contain the account password
- **WHEN** the client calls `mailru_list_messages` with `limit` 2, `offset` 0, and `order` `newest`
- **THEN** the envelope has `total` 1100, `offset` 0, and `limit` 2
- **AND** `messages` uids are 1100 then 1099
- **AND** that call issued more than one `UID FETCH` command, each at most 4096 UTF-8 bytes, excluding the IMAP tag and the line ending
- **AND** those commands together name each uid from 1 through 1100 exactly once
- **AND** no `UID FETCH` command uses `1:*` or a UID range
- **AND** no message includes a message body
- **AND** the result text does not contain the account password

### Requirement: Mail.ru search_messages tool

The Mail.ru connector SHALL declare a tool with short name `search_messages` (MCP name `mailru_search_messages`). Model arguments SHALL include an optional `mailbox` string defaulting to `INBOX`, the same optional `offset`, `limit`, and `order` as `list_messages`, and a narrow filter object whose only allowed keys are `unseen` (boolean), `from` (string), `subject` (string substring), and `since` (date string). The handler SHALL reject a free-form IMAP search string or any filter key outside that set, and SHALL NOT issue that free-form search to the IMAP server. After the filter matches, the handler SHALL apply the same date sort and page rules as `list_messages`, including a null `limit` when the limit is omitted, not an integer, or below 1, and `Invalid order` when `order` is neither `newest` nor `oldest`. `total` SHALL be the number of matches before the cut. Successful results SHALL use the same JSON envelope and the same summary shape as `list_messages` (`uid`, `from`, `to`, `subject`, `date`, `seen`, `unread`) and SHALL NOT include bodies. A call with no offset and no limit SHALL return every match from the start of the chosen order, with envelope `limit` null. Model arguments SHALL NOT contain a URL, a host, a secret, or a raw IMAP command string. Summary fetch for the matched UIDs SHALL follow the same `UID FETCH` batching rules as `list_messages`, including when the matched UIDs are not every UID in the mailbox. Automated tests SHALL use a fake IMAP server and SHALL NOT contact a live mailbox.

#### Scenario: Narrow filter search returns matching summaries on a fake IMAP server

- **GIVEN** an eligible Mail.ru account on an enabled configuration and a fake IMAP server with messages from `alice@example.test` and from another address
- **WHEN** an authenticated MCP client calls `mailru_search_messages` with filter `{ "from": "alice@example.test" }` and no `limit`
- **THEN** the result text parses as a JSON object `{ messages, total, offset, limit }`
- **AND** `offset` is 0 and `limit` is null
- **AND** `messages` includes only messages matching that from filter
- **AND** `total` equals the number of matching messages and equals `messages` length
- **AND** each message has the list_messages summary shape, including `to`, without a body
- **AND** the result text does not contain the account password

#### Scenario: Search applies paging and order after the filter

- **GIVEN** an eligible Mail.ru account on an enabled configuration and a fake IMAP server with uid 1 from `alice@example.test` dated `03 Jan 2024 00:00:00 +0000`, uid 2 from `bob@example.test` dated `04 Jan 2024 00:00:00 +0000`, uid 3 from `alice@example.test` dated `01 Jan 2024 00:00:00 +0000`, and uid 4 from `alice@example.test` dated `02 Jan 2024 00:00:00 +0000`
- **WHEN** an authenticated MCP client calls `mailru_search_messages` with filter `{ "from": "alice@example.test" }`, `order` `oldest`, `limit` 2, and `offset` 0
- **THEN** `total` is 3, `offset` is 0, and `limit` is 2
- **AND** `messages` uids are 3 then 4
- **AND** no message is from `bob@example.test`
- **WHEN** the client calls `mailru_search_messages` with the same filter, `order` `newest`, `limit` 2, and `offset` 2
- **THEN** `total` is 3 and `messages` uids are 3
- **AND** no message includes a message body
- **AND** the result text does not contain the account password

#### Scenario: Unknown search order is rejected

- **GIVEN** an eligible Mail.ru account on an enabled configuration and a fake IMAP server
- **WHEN** an authenticated MCP client calls `mailru_search_messages` with `order` `random` and filter `{ "from": "alice@example.test" }`
- **THEN** the tool call fails
- **AND** the error text contains `Invalid order`
- **AND** the error text does not contain the account password
- **AND** the fake IMAP server was not issued SEARCH

#### Scenario: Free-form IMAP search syntax is rejected

- **GIVEN** an eligible Mail.ru account on an enabled configuration and a fake IMAP server
- **WHEN** an authenticated MCP client calls `mailru_search_messages` with a free-form search string argument or a filter key outside `unseen`, `from`, `subject`, and `since`
- **THEN** the tool call fails without issuing that free-form search to the fake IMAP server
- **AND** the error text does not contain the account password

#### Scenario: Filtered summary fetch stays within the command budget

- **GIVEN** an eligible Mail.ru account on an enabled configuration and a fake IMAP server
- **AND** the fake IMAP server ends the connection without completing the command when any one `UID FETCH` command exceeds 4096 UTF-8 bytes, excluding the IMAP tag and the line ending
- **AND** for each integer `i` from 0 through 399, `INBOX` contains uid `1000000001 + 2 * i` from `alice@example.test` and uid `1000000002 + 2 * i` from `bob@example.test`, both to `me@example.test`
- **AND** uid 1000000799 has date `02 Feb 2024 00:00:00 +0000`
- **AND** uid 1000000797 has date `01 Feb 2024 00:00:00 +0000`
- **AND** every other message has date `01 Jan 2024 00:00:00 +0000`
- **AND** a comma-separated list of the alice uids is longer than 4096 UTF-8 bytes
- **WHEN** an authenticated MCP client calls `mailru_search_messages` with filter `{ "from": "alice@example.test" }`, no `limit`, and `order` `newest`
- **THEN** the result text parses as a JSON object with `messages`, `total`, `offset`, and `limit`
- **AND** `offset` is 0, `limit` is null, and `total` is 400
- **AND** `messages` has length 400
- **AND** `messages[0].uid` is 1000000799, `messages[1].uid` is 1000000797, and `messages[2].uid` is 1000000795
- **AND** the last message uid is 1000000001
- **AND** every message `from` is `alice@example.test` and no message `from` is `bob@example.test`
- **AND** `messages` contains each alice uid exactly once
- **AND** each message includes `uid`, `from`, `to`, `subject`, `date`, `seen`, and `unread`, and includes no message body
- **AND** the call issued more than one `UID FETCH` command
- **AND** each of those commands is at most 4096 UTF-8 bytes, excluding the IMAP tag and the line ending
- **AND** those commands together name each alice uid exactly once and name no bob uid
- **AND** no `UID FETCH` command uses `1:*` or a UID range
- **AND** the result text does not contain the account password
- **WHEN** the client calls `mailru_search_messages` with the same filter, `limit` 2, `offset` 0, and `order` `newest`
- **THEN** the envelope has `total` 400, `offset` 0, and `limit` 2
- **AND** `messages` uids are 1000000799 then 1000000797
- **AND** no message `from` is `bob@example.test`
- **AND** that call issued more than one `UID FETCH` command, each at most 4096 UTF-8 bytes, excluding the IMAP tag and the line ending
- **AND** those commands together name each alice uid exactly once and name no bob uid
- **AND** no `UID FETCH` command uses `1:*` or a UID range
- **AND** no message includes a message body
- **AND** the result text does not contain the account password
