# Spec Delta

## MODIFIED Requirements

### Requirement: Gmail list_messages tool

The Gmail connector SHALL declare a tool with short name `list_messages` (MCP name `gmail_list_messages`). Model arguments SHALL include an optional `mailbox` string that defaults to `INBOX` when omitted or empty, an optional `offset` integer, an optional `limit` integer, and an optional `order` string. When `offset` is omitted, is not an integer, or is less than 0, the applied offset SHALL be 0. When `limit` is omitted, is not an integer, or is less than 1, the applied limit SHALL be 20. When `limit` is greater than 50, the applied limit SHALL be 50. When `order` is omitted, the applied order SHALL be `newest`. When `order` is present and is not `newest` or `oldest`, the tool SHALL fail with English error text that contains `Invalid order` and does not contain the account password. The handler SHALL load the mailbox, sort that set by parsed message date, and then cut the page. `newest` SHALL place the highest date first. `oldest` SHALL place the lowest date first. When two parsed dates are equal, `newest` SHALL place the higher uid first and `oldest` SHALL place the lower uid first. The result SHALL be a JSON object `{ messages, total, offset, limit }`, not a JSON array. `total` SHALL be the size of the mailbox set before the page is cut. `offset` and `limit` in the object SHALL be the applied values. `messages` SHALL be the page after the sort. When the applied offset is greater than or equal to `total`, `messages` SHALL be an empty array and `total` SHALL stay the full set size. Each message SHALL include `uid`, `from`, `subject`, `date`, `seen`, and `unread`, and SHALL NOT include a message body. `unread` SHALL be the boolean opposite of `seen`. `date` SHALL be the message date string. The handler SHALL use the egress TLS session to the IMAP host only. Model arguments SHALL NOT contain a URL, a host, a secret, or a raw IMAP command string. Automated tests SHALL use a fake IMAP server and SHALL NOT contact a live mailbox.

#### Scenario: Default call returns the newest page inside an envelope

- **GIVEN** an enabled configuration whose `accountIds` include an enabled Gmail account, and the MCP app with a fake egress transport backed by a fake IMAP server
- **AND** the plaintext bearer of that configuration is known to the test
- **AND** `INBOX` contains uids 1 through 21
- **AND** uid 1 has date `01 Feb 2024 00:00:00 +0000`
- **AND** each uid `n` from 2 through 21 has date day `n-1` of January 2024 at `00:00:00 +0000`, so uid 2 is `01 Jan 2024 00:00:00 +0000` and uid 21 is `20 Jan 2024 00:00:00 +0000`
- **WHEN** an authenticated MCP client calls `gmail_list_messages` with no `mailbox`, no `offset`, no `limit`, and no `order`
- **THEN** the result text parses as a JSON object with `messages`, `total`, `offset`, and `limit`
- **AND** the parsed value is not an array
- **AND** `offset` is 0, `limit` is 20, and `total` is 21
- **AND** `messages` has length 20
- **AND** `messages[0].uid` is 1
- **AND** no message in `messages` has uid 2
- **AND** each message includes `uid`, `from`, `subject`, `date`, `seen`, and `unread`
- **AND** no message includes a message body
- **AND** the result text does not contain the account password

#### Scenario: Offset and both orders page a mailbox larger than one page

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server whose `INBOX` contains uid 5 dated `04 Jan 2024 00:00:00 +0000`, uid 6 dated `01 Jan 2024 00:00:00 +0000`, uid 7 dated `03 Jan 2024 00:00:00 +0000`, and uid 8 dated `02 Jan 2024 00:00:00 +0000`
- **WHEN** an authenticated MCP client calls `gmail_list_messages` with `limit` 2, `offset` 0, and `order` `newest`
- **THEN** the envelope has `total` 4, `offset` 0, and `limit` 2
- **AND** `messages` uids are 5 then 7
- **WHEN** the client calls `gmail_list_messages` with `limit` 2, `offset` 2, and `order` `newest`
- **THEN** `messages` uids are 8 then 6
- **AND** `total` is 4
- **WHEN** the client calls `gmail_list_messages` with `limit` 2, `offset` 0, and `order` `oldest`
- **THEN** `messages` uids are 6 then 8
- **WHEN** the client calls `gmail_list_messages` with `limit` 2, `offset` 2, and `order` `oldest`
- **THEN** `messages` uids are 7 then 5
- **AND** no message includes a message body
- **AND** the result text does not contain the account password

#### Scenario: List returns capped summaries without bodies on a fake IMAP server

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server that has 60 messages in `INBOX`, uids 1 through 60, every message dated `01 Jan 2024 00:00:00 +0000`
- **WHEN** an authenticated MCP client calls `gmail_list_messages` with `limit` 80 and without `mailbox`
- **THEN** the envelope `limit` is 50, `offset` is 0, and `total` is 60
- **AND** `messages` has length 50
- **AND** `messages[0].uid` is 60
- **AND** the last message uid is 11
- **AND** each message includes `uid`, `from`, `subject`, `date`, `seen`, and `unread`
- **AND** no message includes a message body
- **AND** the result text does not contain the account password

#### Scenario: Invalid offset and limit fall back to defaults

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server whose `INBOX` contains one message
- **WHEN** an authenticated MCP client calls `gmail_list_messages` with `limit` 0 and `offset` -1
- **THEN** the envelope `offset` is 0 and `limit` is 20
- **AND** `total` is 1 and `messages` has length 1

#### Scenario: Offset past the end returns an empty page

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server whose `INBOX` contains one message
- **WHEN** an authenticated MCP client calls `gmail_list_messages` with `offset` 5 and `limit` 20
- **THEN** the envelope `offset` is 5, `limit` is 20, and `total` is 1
- **AND** `messages` is an empty array

#### Scenario: Unknown order is rejected

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server
- **WHEN** an authenticated MCP client calls `gmail_list_messages` with `order` `random`
- **THEN** the tool call fails
- **AND** the error text contains `Invalid order`
- **AND** the error text does not contain the account password

### Requirement: Gmail search_messages tool

The Gmail connector SHALL declare a tool with short name `search_messages` (MCP name `gmail_search_messages`). Model arguments SHALL include an optional `mailbox` string defaulting to `INBOX`, the same optional `offset`, `limit`, and `order` as `list_messages`, and a narrow filter object whose only allowed keys are `unseen` (boolean), `from` (string), `subject` (string substring), and `since` (date string). The handler SHALL reject a free-form IMAP search string or any filter key outside that set, and SHALL NOT issue that free-form search to the IMAP server. After the filter matches, the handler SHALL apply the same date sort and page rules as `list_messages`. `total` SHALL be the number of matches before the page is cut. Successful results SHALL use the same JSON envelope and the same summary shape as `list_messages` (uid, from, subject, date, seen, unread) and SHALL NOT include bodies. A call with no offset and order `newest` SHALL return the first page of the newest matches inside that envelope. Model arguments SHALL NOT contain a URL, a host, a secret, or a raw IMAP command string. Automated tests SHALL use a fake IMAP server and SHALL NOT contact a live mailbox.

#### Scenario: Narrow filter search returns matching summaries on a fake IMAP server

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server with messages from `alice@example.test` and from another address
- **WHEN** an authenticated MCP client calls `gmail_search_messages` with filter `{ "from": "alice@example.test" }`
- **THEN** the result text parses as a JSON object `{ messages, total, offset, limit }`
- **AND** `messages` includes only messages matching that from filter
- **AND** `total` equals the number of matching messages
- **AND** each message has the list_messages summary shape without a body
- **AND** the result text does not contain the account password

#### Scenario: Search applies paging and order after the filter

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server with uid 1 from `alice@example.test` dated `03 Jan 2024 00:00:00 +0000`, uid 2 from `bob@example.test` dated `04 Jan 2024 00:00:00 +0000`, uid 3 from `alice@example.test` dated `01 Jan 2024 00:00:00 +0000`, and uid 4 from `alice@example.test` dated `02 Jan 2024 00:00:00 +0000`
- **WHEN** an authenticated MCP client calls `gmail_search_messages` with filter `{ "from": "alice@example.test" }`, `order` `oldest`, `limit` 2, and `offset` 0
- **THEN** `total` is 3, `offset` is 0, and `limit` is 2
- **AND** `messages` uids are 3 then 4
- **AND** no message is from `bob@example.test`
- **WHEN** the client calls `gmail_search_messages` with the same filter, `order` `newest`, `limit` 2, and `offset` 2
- **THEN** `total` is 3 and `messages` uids are 3
- **AND** no message includes a message body
- **AND** the result text does not contain the account password

#### Scenario: Free-form IMAP search syntax is rejected

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server
- **WHEN** an authenticated MCP client calls `gmail_search_messages` with a free-form search string argument or a filter key outside `unseen`, `from`, `subject`, and `since`
- **THEN** the tool call fails without issuing that free-form search to the fake IMAP server
- **AND** the error text does not contain the account password

### Requirement: Password never appears in Gmail tool or admin surfaces

The Gmail app password SHALL NOT appear in tool result text, MCP error text, or admin API response bodies for create, patch, check, list, or get-account paths that involve a Gmail account. Tests SHALL use a fixture password string and assert it is absent from those serialized bodies after scrubbing and fixed error mapping. A failed `gmail_move_message` call SHALL also omit that fixture password from MCP error text when the fake IMAP error message contains it.

#### Scenario: Fixture password absent from tool result and MCP error

- **GIVEN** an eligible Gmail account whose `password` field is a fixture secret, and a fake IMAP path that either returns a successful list or throws an error whose message contains that fixture secret
- **WHEN** an authenticated MCP client calls `gmail_list_messages` for each case
- **THEN** neither the successful result text nor the MCP error text contains the fixture secret

#### Scenario: Fixture password absent from move_message failure

- **GIVEN** an eligible Gmail account whose `password` field is a fixture secret
- **AND** a destination mailbox that already exists
- **AND** a fake IMAP server that fails the move with an error message that contains that fixture secret
- **WHEN** an authenticated MCP client calls `gmail_move_message` for that message and destination
- **THEN** the MCP error text does not contain the fixture secret

## ADDED Requirements

### Requirement: Gmail list_mailboxes tool

The Gmail connector SHALL declare a tool with short name `list_mailboxes` (MCP name `gmail_list_mailboxes`). Model arguments SHALL NOT include a host, a URL, a secret, or a raw IMAP command string. The handler SHALL use the egress TLS session to the IMAP host only. The result SHALL be a JSON array of the folder name strings the server lists, each name once. The result SHALL NOT include message bodies. Automated tests SHALL use a fake IMAP server and SHALL NOT contact a live mailbox.

#### Scenario: List mailboxes returns folder names from the fake server

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server that lists the folders `INBOX` and `Archive`
- **WHEN** an authenticated MCP client calls `gmail_list_mailboxes` with no host argument
- **THEN** the result text parses as a JSON array of strings
- **AND** that array contains `INBOX` and `Archive` exactly once each and no other names
- **AND** the result text does not contain the account password
- **AND** the result text does not contain `imap.gmail.com`

### Requirement: Gmail create_mailbox tool

The Gmail connector SHALL declare a tool with short name `create_mailbox` (MCP name `gmail_create_mailbox`). Model arguments SHALL include a required `name` string and SHALL NOT include a host, a URL, a secret, or a raw IMAP command string. The handler SHALL create that folder through the egress TLS session to the IMAP host only. A name that is empty or only whitespace SHALL be rejected with English error text that contains `Mailbox name is required`, and no folder SHALL be created. A successful result SHALL be a JSON object that includes that `name` and SHALL NOT include a message body or the account password. Automated tests SHALL use a fake IMAP server and SHALL NOT contact a live mailbox.

#### Scenario: Create mailbox adds a folder

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server that lists `INBOX`
- **WHEN** an authenticated MCP client calls `gmail_create_mailbox` with `name` `Projects`
- **THEN** the result text parses as a JSON object whose `name` is `Projects`
- **AND** a following `gmail_list_mailboxes` result contains `Projects`
- **AND** the result text does not contain the account password

#### Scenario: Empty mailbox name is rejected

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server that lists `INBOX`
- **WHEN** an authenticated MCP client calls `gmail_create_mailbox` with `name` `""`
- **THEN** the tool call fails
- **AND** the error text contains `Mailbox name is required`
- **AND** the error text does not contain the account password
- **WHEN** the client calls `gmail_create_mailbox` with `name` `"   "`
- **THEN** the tool call fails with error text that contains `Mailbox name is required`
- **AND** `gmail_list_mailboxes` does not include an empty name

### Requirement: Gmail move_message tool

The Gmail connector SHALL declare a tool with short name `move_message` (MCP name `gmail_move_message`). Model arguments SHALL include a required `uid` integer greater than or equal to 1, an optional source `mailbox` string that defaults to `INBOX`, and a required destination mailbox string. Model arguments SHALL NOT include a host, a URL, a secret, or a raw IMAP command string. The handler SHALL use the egress TLS session to the IMAP host only. The destination MUST already exist. When it does not, the tool SHALL fail with English error text that contains `Destination mailbox does not exist`, the message SHALL stay in the source, and the error text SHALL NOT contain the account password. When `uid` is missing, is not an integer, or is less than 1, the tool SHALL fail with English error text that contains `uid is required`, and the message SHALL stay in the source. A successful move SHALL remove that uid from the source mailbox. A successful result SHALL be a JSON object with `uid`, `source`, and `destination`, and SHALL NOT include a message body or the account password. Automated tests SHALL use a fake IMAP server and SHALL NOT contact a live mailbox.

#### Scenario: Move message into an existing mailbox

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server
- **AND** `INBOX` contains uid 7 from `alice@example.test` with subject `Move me`
- **AND** the folder `Archive` already exists and is empty
- **WHEN** an authenticated MCP client calls `gmail_move_message` with `uid` 7 and `destination` `Archive` and without `mailbox`
- **THEN** the result text parses as a JSON object with `uid` 7, `source` `INBOX`, and `destination` `Archive`
- **AND** the result text does not include a message body and does not contain the account password
- **AND** `gmail_list_messages` on `INBOX` does not include uid 7
- **AND** `gmail_list_messages` on `Archive` includes a summary with subject `Move me` and from `alice@example.test`

#### Scenario: Missing destination leaves the message in the source

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server whose `INBOX` contains uid 7 and that does not list a folder named `Missing`
- **WHEN** an authenticated MCP client calls `gmail_move_message` with `uid` 7 and `destination` `Missing`
- **THEN** the tool call fails
- **AND** the error text contains `Destination mailbox does not exist`
- **AND** the error text does not contain the account password
- **AND** `gmail_list_messages` on `INBOX` still includes uid 7

#### Scenario: Uid below 1 is rejected

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server whose `INBOX` contains uid 7 and whose folder `Archive` already exists
- **WHEN** an authenticated MCP client calls `gmail_move_message` with `uid` 0 and `destination` `Archive`
- **THEN** the tool call fails
- **AND** the error text contains `uid is required`
- **AND** the error text does not contain the account password
- **AND** `gmail_list_messages` on `INBOX` still includes uid 7
