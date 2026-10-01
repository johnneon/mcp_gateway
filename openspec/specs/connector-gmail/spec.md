# connector-gmail Specification

## Purpose

Defines the native Gmail connector: mailbox credentials, constant IMAP and SMTP hosts, connection check over the egress TLS session, and MCP tools that list, search, and read messages without exposing the app password or contacting a live mailbox in tests.

## Requirements

### Requirement: Gmail connector module identity and fields

The process SHALL register a native connector with `id` exactly `gmail`, display `name` exactly `Gmail`, and `kind` exactly `native`. The connector SHALL declare exactly these account fields: `address` with type `text`, `required` true, and English label `Address`; and `password` with type `secret`, `required` true, and English label `App password`. The connector SHALL declare `allowedDestinations` as the constant pairs `{ host: "imap.gmail.com", port: 993 }` and `{ host: "smtp.gmail.com", port: 465 }` and SHALL NOT take hosts from model arguments or from account fields of type `host`.

#### Scenario: Production registry lists Gmail with Address and App password fields

- **GIVEN** the production connector registry module
- **WHEN** its public connector list is read
- **THEN** the list includes a connector with `id` `gmail`, `name` `Gmail`, and `kind` `native`
- **AND** that connector's fields include `{ name: "address", label: "Address", type: "text", required: true }` and `{ name: "password", label: "App password", type: "secret", required: true }`

#### Scenario: Gmail allowlist is the two constant hosts

- **GIVEN** the Gmail connector module from the production registry
- **WHEN** its `allowedDestinations` are read
- **THEN** they are exactly `{ host: "imap.gmail.com", port: 993 }` and `{ host: "smtp.gmail.com", port: 465 }`

### Requirement: Gmail connection check uses IMAP LOGIN and SMTP AUTH over egress

The Gmail connector's `checkConnection` SHALL receive account field values and the gateway-built egress client. It SHALL open a TLS session to `imap.gmail.com:993` and perform IMAP LOGIN with `address` and `password`, and SHALL open a TLS session to `smtp.gmail.com:465` and perform SMTP AUTH with the same credentials. The check SHALL succeed only when both authentications succeed. The check SHALL NOT send mail. Automated tests SHALL use a fake IMAP server and a fake SMTP server behind a fake egress transport and SHALL NOT contact a live mailbox. On failure, the admin API surface remains the fixed plain text `Connection check failed` with no connector exception text and no password in the response.

#### Scenario: Successful check when fake IMAP and SMTP both accept login

- **GIVEN** the admin app with the Gmail connector and a fake egress transport whose TLS sessions speak to a fake IMAP server and a fake SMTP server that both accept the fixture address and password
- **WHEN** the client performs `POST /api/accounts` with connector `gmail`, a non-empty label, and those fixture values
- **THEN** the response status is 201
- **AND** the account is persisted
- **AND** the serialized response body does not contain the fixture password

#### Scenario: Failed check when fake IMAP rejects login

- **GIVEN** the admin app with the Gmail connector and a fake egress transport whose fake IMAP server rejects LOGIN while the fake SMTP server would accept AUTH
- **WHEN** the client performs `POST /api/accounts` with connector `gmail` and otherwise valid values including a fixture password
- **THEN** the response status is 400
- **AND** the response body is exactly the plain text `Connection check failed`
- **AND** the serialized response body does not contain the fixture password
- **AND** the account is not saved

#### Scenario: Failed check when fake SMTP rejects AUTH

- **GIVEN** the admin app with the Gmail connector and a fake egress transport whose fake IMAP server accepts LOGIN and whose fake SMTP server rejects AUTH
- **WHEN** the client performs `POST /api/accounts` with connector `gmail` and otherwise valid values including a fixture password
- **THEN** the response status is 400
- **AND** the response body is exactly the plain text `Connection check failed`
- **AND** the serialized response body does not contain the fixture password
- **AND** the account is not saved

### Requirement: Gmail list_messages tool

The Gmail connector SHALL declare a tool with short name `list_messages` (MCP name `gmail_list_messages`). Model arguments SHALL include an optional `mailbox` string that defaults to `INBOX` when omitted or empty, an optional `offset` integer, an optional `limit` integer, and an optional `order` string. When `offset` is omitted, is not an integer, or is less than 0, the applied offset SHALL be 0. When `limit` is omitted, is not an integer, or is less than 1, the tool SHALL return the entire matching set from the applied offset and the envelope `limit` SHALL be null. When `limit` is an integer greater than or equal to 1, the applied limit SHALL be that integer and SHALL have no maximum. When `order` is omitted, the applied order SHALL be `newest`. When `order` is present and is not `newest` or `oldest`, the tool SHALL fail with English error text that contains `Invalid order` and does not contain the account password, and SHALL NOT issue SEARCH. The handler SHALL load the mailbox, sort that set by parsed message date, and then cut. `newest` SHALL place the highest date first. `oldest` SHALL place the lowest date first. A date that does not parse SHALL sort as older than every date that does. When two parsed dates are equal, `newest` SHALL place the higher uid first and `oldest` SHALL place the lower uid first. The same uid tie-break SHALL apply to two unparseable dates. The result SHALL be a JSON object `{ messages, total, offset, limit }`, not a JSON array. `total` SHALL be the size of the mailbox set before the cut. `offset` and `limit` in the object SHALL be the applied values. `messages` SHALL be the cut after the sort. When the applied offset is greater than or equal to `total`, `messages` SHALL be an empty array and `total` SHALL stay the full set size. Each message SHALL include `uid`, `from`, `to`, `subject`, `date`, `seen`, and `unread`, and SHALL NOT include a message body. `unread` SHALL be the boolean opposite of `seen`. `date` SHALL be the message date string. `to` SHALL be the To header, or an empty string when that header is absent. Passing `mailbox` SHALL select that folder, including a folder whose name came from `list_mailboxes`. The handler SHALL use the egress TLS session to the IMAP host only. Model arguments SHALL NOT contain a URL, a host, a secret, or a raw IMAP command string. Automated tests SHALL use a fake IMAP server and SHALL NOT contact a live mailbox.

#### Scenario: Default call returns the full newest set inside an envelope

- **GIVEN** an enabled configuration whose `accountIds` include an enabled Gmail account, and the MCP app with a fake egress transport backed by a fake IMAP server
- **AND** the plaintext bearer of that configuration is known to the test
- **AND** `INBOX` contains uids 1 through 21, each from `alice@example.test` and to `me@example.test`
- **AND** uid 1 is seen and has date `01 Feb 2024 00:00:00 +0000`
- **AND** each uid `n` from 2 through 21 is unseen and has date day `n-1` of January 2024 at `00:00:00 +0000`, so uid 2 is `01 Jan 2024 00:00:00 +0000` and uid 21 is `20 Jan 2024 00:00:00 +0000`
- **WHEN** an authenticated MCP client calls `gmail_list_messages` with no `mailbox`, no `offset`, no `limit`, and no `order`
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
- **AND** each message includes `to`
- **AND** no message includes a message body
- **AND** the result text does not contain the account password

#### Scenario: List returns capped summaries without bodies on a fake IMAP server

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server that has 60 messages in `INBOX`, uids 1 through 60, every message dated `01 Jan 2024 00:00:00 +0000` and to `me@example.test`
- **WHEN** an authenticated MCP client calls `gmail_list_messages` with `limit` 80 and without `mailbox`
- **THEN** the envelope `limit` is 80, `offset` is 0, and `total` is 60
- **AND** `messages` has length 60
- **AND** `messages[0].uid` is 60
- **AND** the last message uid is 1
- **AND** each message includes `uid`, `from`, `to`, `subject`, `date`, `seen`, and `unread`
- **AND** no message includes a message body
- **AND** the result text does not contain the account password

#### Scenario: Provided limit is honored with no maximum

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server that has 60 messages in `INBOX`, uids 1 through 60, every message dated `01 Jan 2024 00:00:00 +0000`
- **WHEN** an authenticated MCP client calls `gmail_list_messages` with `limit` 2, `offset` 0, and `order` `oldest`
- **THEN** the envelope `limit` is 2, `offset` is 0, and `total` is 60
- **AND** `messages` uids are 1 then 2
- **AND** no message includes a message body
- **AND** the result text does not contain the account password

#### Scenario: Unparseable dates sort as oldest

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server whose `INBOX` contains uid 1 dated `not-a-date`, uid 2 dated `02 Jan 2024 00:00:00 +0000`, and uid 3 dated `not-a-date`
- **WHEN** an authenticated MCP client calls `gmail_list_messages` with `order` `newest` and no `limit`
- **THEN** `messages` uids are 2, then 3, then 1
- **AND** `limit` is null and `total` is 3
- **WHEN** the client calls `gmail_list_messages` with `order` `oldest` and no `limit`
- **THEN** `messages` uids are 1, then 3, then 2

#### Scenario: Invalid offset and limit return the full remainder

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server whose `INBOX` contains one message
- **WHEN** an authenticated MCP client calls `gmail_list_messages` with `limit` 0 and `offset` -1
- **THEN** the envelope `offset` is 0 and `limit` is null
- **AND** `total` is 1 and `messages` has length 1
- **WHEN** the client calls `gmail_list_messages` with `limit` 1.5 and `offset` -4
- **THEN** the envelope `offset` is 0 and `limit` is null
- **AND** `total` is 1 and `messages` has length 1

#### Scenario: Offset past the end returns an empty page

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server whose `INBOX` contains one message
- **WHEN** an authenticated MCP client calls `gmail_list_messages` with `offset` 5 and `limit` 20
- **THEN** the envelope `offset` is 5, `limit` is 20, and `total` is 1
- **AND** `messages` is an empty array
- **WHEN** the client calls `gmail_list_messages` with `offset` 5 and no `limit`
- **THEN** the envelope `offset` is 5, `limit` is null, and `total` is 1
- **AND** `messages` is an empty array

#### Scenario: Unknown order is rejected

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server
- **WHEN** an authenticated MCP client calls `gmail_list_messages` with `order` `random`
- **THEN** the tool call fails
- **AND** the error text contains `Invalid order`
- **AND** the error text does not contain the account password
- **AND** the fake IMAP server was not issued SEARCH

#### Scenario: Sent, Drafts, Spam, and Trash are listed by server mailbox name

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server
- **AND** `INBOX` has LIST attribute `\Inbox` and a message with subject `Inbox note`
- **AND** a mailbox named `Sent Items` has LIST attribute `\Sent` and a message with subject `Sent note`
- **AND** a mailbox named `Drafts` has LIST attribute `\Drafts` and a message with subject `Draft note`
- **AND** a mailbox named `Spam` has LIST attribute `\Junk` and a message with subject `Spam note`
- **AND** a mailbox named `Deleted Items` has LIST attribute `\Trash` and a message with subject `Trash note`
- **WHEN** an authenticated MCP client calls `gmail_list_mailboxes` and then `gmail_list_messages` with `mailbox` set to the listed name whose `specialUse` is `sent`
- **THEN** that name is `Sent Items`
- **AND** `messages` includes the subject `Sent note` and does not include `Inbox note`
- **AND** no message includes a message body
- **WHEN** the client calls `gmail_list_messages` with the listed name whose `specialUse` is `drafts`
- **THEN** `messages` includes the subject `Draft note`
- **WHEN** the client calls `gmail_list_messages` with the listed name whose `specialUse` is `junk`
- **THEN** `messages` includes the subject `Spam note`
- **WHEN** the client calls `gmail_list_messages` with the listed name whose `specialUse` is `trash`
- **THEN** `messages` includes the subject `Trash note`
- **AND** the result text does not contain the account password
- **AND** the result text does not contain `[Gmail]/`

### Requirement: Gmail search_messages tool

The Gmail connector SHALL declare a tool with short name `search_messages` (MCP name `gmail_search_messages`). Model arguments SHALL include an optional `mailbox` string defaulting to `INBOX`, the same optional `offset`, `limit`, and `order` as `list_messages`, and a narrow filter object whose only allowed keys are `unseen` (boolean), `from` (string), `subject` (string substring), and `since` (date string). The handler SHALL reject a free-form IMAP search string or any filter key outside that set, and SHALL NOT issue that free-form search to the IMAP server. After the filter matches, the handler SHALL apply the same date sort and page rules as `list_messages`, including a null `limit` when the limit is omitted, not an integer, or below 1, and `Invalid order` when `order` is neither `newest` nor `oldest`. `total` SHALL be the number of matches before the cut. Successful results SHALL use the same JSON envelope and the same summary shape as `list_messages` (`uid`, `from`, `to`, `subject`, `date`, `seen`, `unread`) and SHALL NOT include bodies. A call with no offset and no limit SHALL return every match from the start of the chosen order, with envelope `limit` null. Model arguments SHALL NOT contain a URL, a host, a secret, or a raw IMAP command string. Automated tests SHALL use a fake IMAP server and SHALL NOT contact a live mailbox.

#### Scenario: Narrow filter search returns matching summaries on a fake IMAP server

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server with messages from `alice@example.test` and from another address
- **WHEN** an authenticated MCP client calls `gmail_search_messages` with filter `{ "from": "alice@example.test" }` and no `limit`
- **THEN** the result text parses as a JSON object `{ messages, total, offset, limit }`
- **AND** `offset` is 0 and `limit` is null
- **AND** `messages` includes only messages matching that from filter
- **AND** `total` equals the number of matching messages and equals `messages` length
- **AND** each message has the list_messages summary shape, including `to`, without a body
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

#### Scenario: Unknown search order is rejected

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server
- **WHEN** an authenticated MCP client calls `gmail_search_messages` with `order` `random` and filter `{ "from": "alice@example.test" }`
- **THEN** the tool call fails
- **AND** the error text contains `Invalid order`
- **AND** the error text does not contain the account password
- **AND** the fake IMAP server was not issued SEARCH

#### Scenario: Free-form IMAP search syntax is rejected

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server
- **WHEN** an authenticated MCP client calls `gmail_search_messages` with a free-form search string argument or a filter key outside `unseen`, `from`, `subject`, and `since`
- **THEN** the tool call fails without issuing that free-form search to the fake IMAP server
- **AND** the error text does not contain the account password

### Requirement: Gmail read_message tool

The Gmail connector SHALL declare a tool with short name `read_message` (MCP name `gmail_read_message`). Model arguments SHALL include an optional `mailbox` string defaulting to `INBOX` and a required `uid` integer greater than or equal to 1. When `uid` is missing, is not an integer, or is less than 1, the tool SHALL fail with English error text that contains `uid is required` and SHALL NOT fetch the message. When `uid` is an integer greater than or equal to 1 and is not in the mailbox, the tool SHALL fail with English error text that contains `Message not found` and the error text SHALL NOT contain the account password. The result SHALL be a JSON object with `from`, `to`, `subject`, `date`, `textBody`, `htmlBody`, and `attachments`. `textBody` SHALL be the text/plain body, or an empty string when that part is absent. `htmlBody` SHALL be the text/html body, or an empty string when that part is absent. `attachments` SHALL be an array of `{ index, name, contentType, size }` for each attachment part, with `index` starting at 0, and SHALL be an empty array when there is no attachment. The result SHALL NOT include attachment bytes, a `data` field, or `attachmentNames`. Model arguments SHALL NOT contain a URL, a host, a secret, or a raw IMAP command string. The handler SHALL use the egress TLS session to the IMAP host only. Automated tests SHALL use a fake IMAP server and SHALL NOT contact a live mailbox.

#### Scenario: Read returns headers and text body without attachment bytes

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server
- **AND** a message uid 42 from `alice@example.test` to `me@example.test` with subject `With attachment`, a text body `Readable text body`, an HTML body `<p>Readable html</p>`, and one attachment named `file.bin` of content type `application/octet-stream` whose decoded bytes are `file-bytes`
- **WHEN** an authenticated MCP client calls `gmail_read_message` with `uid` 42
- **THEN** the result text parses as a JSON object with `from` `alice@example.test`, `to` `me@example.test`, `subject` `With attachment`, `textBody` `Readable text body`, and `htmlBody` `<p>Readable html</p>`
- **AND** `attachments` is an array of one object `{ index: 0, name: "file.bin", contentType: "application/octet-stream", size: 10 }`
- **AND** the result text does not contain `file-bytes`
- **AND** the result text does not contain `attachmentNames`
- **AND** the result text does not contain the account password

#### Scenario: Missing HTML part yields an empty string

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server with a message uid 7 whose text body is `Plain only` and that has no text/html part and no attachment
- **WHEN** an authenticated MCP client calls `gmail_read_message` with `uid` 7
- **THEN** `textBody` is `Plain only`
- **AND** `htmlBody` is `""`
- **AND** `attachments` is an empty array
- **AND** the result text does not contain the account password

### Requirement: Shared mail protocol is separate from the Gmail connector

IMAP and SMTP protocol logic SHALL live in a shared module that speaks only over an already-connected egress duplex and accepts host and credential mapping from the caller. The Gmail connector SHALL supply hosts, field mapping, connection check, and tools, and SHALL NOT embed a second IMAP/SMTP stack. Automated tests of the shared module SHALL use fake IMAP and fake SMTP servers and SHALL NOT contact a live provider.

#### Scenario: Shared module authenticates over a duplex without opening its own TCP socket

- **GIVEN** a fake duplex connected to a fake IMAP server that accepts LOGIN
- **WHEN** the shared mail module performs IMAP LOGIN over that duplex with fixture credentials
- **THEN** LOGIN succeeds
- **AND** the module did not open a separate TCP or TLS socket outside the provided duplex

### Requirement: Password never appears in Gmail tool or admin surfaces

The Gmail app password SHALL NOT appear in tool result text, MCP error text, or admin API response bodies for create, patch, check, list, or get-account paths that involve a Gmail account. Tests SHALL use a fixture password string and assert it is absent from those serialized bodies after scrubbing and fixed error mapping. A failed `gmail_move_message`, `gmail_copy_message`, `gmail_update_flags`, `gmail_delete_mailbox`, or `gmail_get_attachment` call SHALL also omit that fixture password from MCP error text when the fake IMAP `NO` line contains it. The mailbox, flags, and message location SHALL stay as they were when that call fails.

#### Scenario: Fixture password absent from tool result and MCP error

- **GIVEN** an eligible Gmail account whose `password` field is a fixture secret, and a fake IMAP path that either returns a successful list or throws an error whose message contains that fixture secret
- **WHEN** an authenticated MCP client calls `gmail_list_messages` for each case
- **THEN** neither the successful result text nor the MCP error text contains the fixture secret

#### Scenario: Fixture password absent from move_message failure

- **GIVEN** an eligible Gmail account whose `password` field is a fixture secret
- **AND** a destination mailbox that already exists
- **AND** a fake IMAP server that fails the move with a `NO` line that contains that fixture secret
- **WHEN** an authenticated MCP client calls `gmail_move_message` for that message and destination
- **THEN** the MCP error text does not contain the fixture secret
- **AND** the message stays in the source mailbox

#### Scenario: Fixture password absent from copy_message failure

- **GIVEN** an eligible Gmail account whose `password` field is a fixture secret
- **AND** a destination mailbox that already exists
- **AND** a fake IMAP server that fails the copy with a `NO` line that contains that fixture secret
- **WHEN** an authenticated MCP client calls `gmail_copy_message` for that message and destination
- **THEN** the MCP error text does not contain the fixture secret
- **AND** the source message stays in the source mailbox
- **AND** the destination does not gain that message

#### Scenario: Fixture password absent from update_flags failure

- **GIVEN** an eligible Gmail account whose `password` field is a fixture secret
- **AND** a message that is unseen and not flagged
- **AND** a fake IMAP server that fails STORE with a `NO` line that contains that fixture secret
- **WHEN** an authenticated MCP client calls `gmail_update_flags` with `seen` true for that message
- **THEN** the MCP error text does not contain the fixture secret
- **AND** the message stays unseen and not flagged

#### Scenario: Fixture password absent from delete_mailbox failure

- **GIVEN** an eligible Gmail account whose `password` field is a fixture secret
- **AND** a mailbox named `Projects` that is not the inbox
- **AND** a fake IMAP server that fails DELETE with a `NO` line that contains that fixture secret
- **WHEN** an authenticated MCP client calls `gmail_delete_mailbox` with `name` `Projects`
- **THEN** the MCP error text does not contain the fixture secret
- **AND** `gmail_list_mailboxes` still includes `Projects`

#### Scenario: Fixture password absent from get_attachment failure

- **GIVEN** an eligible Gmail account whose `password` field is a fixture secret
- **AND** a message that has an attachment at index 0
- **AND** a fake IMAP server that fails the attachment fetch with a `NO` line that contains that fixture secret
- **WHEN** an authenticated MCP client calls `gmail_get_attachment` for that uid and index 0
- **THEN** the MCP error text does not contain the fixture secret
- **AND** the error text is not a successful attachment object

### Requirement: Gmail list_mailboxes tool

The Gmail connector SHALL declare a tool with short name `list_mailboxes` (MCP name `gmail_list_mailboxes`). Model arguments SHALL NOT include a host, a URL, a secret, or a raw IMAP command string. The handler SHALL use the egress TLS session to the IMAP host only. The result SHALL be a JSON array of objects `{ name, specialUse }`, each listed name once. `specialUse` SHALL be derived only from LIST attributes: `\Inbox` to `inbox`, `\Sent` to `sent`, `\Drafts` to `drafts`, `\Junk` to `junk`, `\Trash` to `trash`, `\Archive` to `archive`, `\Flagged` to `flagged`, `\All` to `all`, and `none` when none of those attributes is present. When several of those attributes are present, the first match in that order SHALL win. The result SHALL NOT include a host, message bodies, or a hard-coded provider folder name that the server did not list. Automated tests SHALL use a fake IMAP server and SHALL NOT contact a live mailbox.

#### Scenario: List mailboxes returns name and special use

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server that lists `INBOX` with `\Inbox`, `Sent Items` with `\Sent`, `Drafts` with `\Drafts`, `Spam` with `\Junk`, `Deleted Items` with `\Trash`, `Old Mail` with `\Archive`, `Starred` with `\Flagged`, `Everything` with `\All`, and `Projects` with no special-use attribute
- **WHEN** an authenticated MCP client calls `gmail_list_mailboxes` with no host argument
- **THEN** the result text parses as a JSON array of objects with `name` and `specialUse`
- **AND** the array contains exactly those nine names, once each
- **AND** `specialUse` is `inbox` for `INBOX`, `sent` for `Sent Items`, `drafts` for `Drafts`, `junk` for `Spam`, `trash` for `Deleted Items`, `archive` for `Old Mail`, `flagged` for `Starred`, `all` for `Everything`, and `none` for `Projects`
- **AND** the result text does not contain the account password
- **AND** the result text does not contain `imap.gmail.com`
- **AND** the result text does not contain `[Gmail]/`

### Requirement: Gmail create_mailbox tool

The Gmail connector SHALL declare a tool with short name `create_mailbox` (MCP name `gmail_create_mailbox`). Model arguments SHALL include a required `name` string and SHALL NOT include a host, a URL, a secret, or a raw IMAP command string. The handler SHALL create that folder through the egress TLS session to the IMAP host only. A name that is empty or only whitespace SHALL be rejected with English error text that contains `Mailbox name is required`, and no CREATE SHALL be sent. A successful result SHALL be a JSON object `{ name }` and SHALL NOT include a message body or the account password. Automated tests SHALL use a fake IMAP server and SHALL NOT contact a live mailbox.

#### Scenario: Create mailbox adds a folder

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server that lists `INBOX`
- **WHEN** an authenticated MCP client calls `gmail_create_mailbox` with `name` `Projects`
- **THEN** the result text parses as a JSON object whose `name` is `Projects`
- **AND** a following `gmail_list_mailboxes` result contains an entry whose `name` is `Projects` and whose `specialUse` is `none`
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

### Requirement: Gmail rename_mailbox tool

The Gmail connector SHALL declare a tool with short name `rename_mailbox` (MCP name `gmail_rename_mailbox`). Model arguments SHALL include required `name` and `newName` strings and SHALL NOT include a host, a URL, a secret, or a raw IMAP command string. A `name` or `newName` that is empty or only whitespace SHALL be rejected with English error text that contains `Mailbox name is required`, and no RENAME SHALL be sent. Renaming the mailbox whose `specialUse` is `inbox`, or a mailbox whose name equals `INBOX` ignoring case, SHALL fail with English error text that contains `Inbox cannot be renamed`, and no RENAME SHALL be sent. A successful result SHALL be a JSON object `{ name, newName }`. The handler SHALL use the egress TLS session to the IMAP host only. Automated tests SHALL use a fake IMAP server and SHALL NOT contact a live mailbox.

#### Scenario: Rename mailbox changes the folder name

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server that lists `Projects` with a message subject `Keep me`
- **WHEN** an authenticated MCP client calls `gmail_rename_mailbox` with `name` `Projects` and `newName` `Archive`
- **THEN** the result text parses as a JSON object with `name` `Projects` and `newName` `Archive`
- **AND** a following `gmail_list_mailboxes` result contains `Archive` and does not contain `Projects`
- **AND** `gmail_list_messages` on `Archive` includes the subject `Keep me`
- **AND** the result text does not contain the account password

#### Scenario: Empty rename is rejected

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server that lists `Projects`
- **WHEN** an authenticated MCP client calls `gmail_rename_mailbox` with `name` `""` and `newName` `Archive`
- **THEN** the tool call fails
- **AND** the error text contains `Mailbox name is required`
- **AND** `gmail_list_mailboxes` still contains `Projects` and does not contain `Archive`
- **WHEN** the client calls `gmail_rename_mailbox` with `name` `Projects` and `newName` `"   "`
- **THEN** the tool call fails with error text that contains `Mailbox name is required`
- **AND** the error text does not contain the account password
- **AND** `gmail_list_mailboxes` still contains `Projects`

#### Scenario: Inbox cannot be renamed

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server that lists `INBOX` and a mailbox named `Incoming` whose LIST attribute is `\Inbox`
- **WHEN** an authenticated MCP client calls `gmail_rename_mailbox` with `name` `INBOX` and `newName` `Elsewhere`
- **THEN** the tool call fails
- **AND** the error text contains `Inbox cannot be renamed`
- **AND** the error text does not contain the account password
- **AND** `gmail_list_mailboxes` still contains `INBOX` and does not contain `Elsewhere`
- **WHEN** the client calls `gmail_rename_mailbox` with `name` `inbox` and `newName` `Elsewhere`
- **THEN** the tool call fails with error text that contains `Inbox cannot be renamed`
- **WHEN** the client calls `gmail_rename_mailbox` with `name` `Incoming` and `newName` `Elsewhere`
- **THEN** the tool call fails with error text that contains `Inbox cannot be renamed`
- **AND** `gmail_list_mailboxes` still contains `Incoming`

### Requirement: Gmail delete_mailbox tool

The Gmail connector SHALL declare a tool with short name `delete_mailbox` (MCP name `gmail_delete_mailbox`). Model arguments SHALL include a required `name` string and SHALL NOT include a host, a URL, a secret, or a raw IMAP command string. A name that is empty or only whitespace SHALL be rejected with English error text that contains `Mailbox name is required`, and no DELETE SHALL be sent. Deleting the mailbox whose `specialUse` is `inbox`, or a mailbox whose name equals `INBOX` ignoring case, SHALL fail with English error text that contains `Inbox cannot be deleted`, and no DELETE SHALL be sent. Otherwise the handler SHALL send IMAP DELETE for that name. It SHALL NOT expunge and SHALL NOT move messages first. When the server replies NO, the mailbox SHALL stay and the error text SHALL NOT contain the account password. A successful result SHALL be a JSON object `{ name }`. The handler SHALL use the egress TLS session to the IMAP host only. Automated tests SHALL use a fake IMAP server and SHALL NOT contact a live mailbox.

#### Scenario: Delete mailbox removes the folder

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server
- **AND** a mailbox named `Projects` contains a message with subject `Gone with the folder`
- **AND** a trash mailbox exists
- **WHEN** an authenticated MCP client calls `gmail_delete_mailbox` with `name` `Projects`
- **THEN** the result text parses as a JSON object whose `name` is `Projects`
- **AND** a following `gmail_list_mailboxes` result does not contain `Projects`
- **AND** the trash mailbox does not contain the subject `Gone with the folder`
- **AND** the result text does not contain the account password

#### Scenario: Empty delete name is rejected

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server that lists `INBOX`
- **WHEN** an authenticated MCP client calls `gmail_delete_mailbox` with `name` `""`
- **THEN** the tool call fails
- **AND** the error text contains `Mailbox name is required`
- **AND** the error text does not contain the account password
- **WHEN** the client calls `gmail_delete_mailbox` with `name` `"   "`
- **THEN** the tool call fails with error text that contains `Mailbox name is required`
- **AND** `gmail_list_mailboxes` still contains `INBOX`

#### Scenario: Inbox cannot be deleted

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server that lists `INBOX` and a mailbox named `Incoming` whose LIST attribute is `\Inbox`
- **WHEN** an authenticated MCP client calls `gmail_delete_mailbox` with `name` `INBOX`
- **THEN** the tool call fails
- **AND** the error text contains `Inbox cannot be deleted`
- **AND** the error text does not contain the account password
- **AND** `gmail_list_mailboxes` still contains `INBOX`
- **WHEN** the client calls `gmail_delete_mailbox` with `name` `inbox`
- **THEN** the tool call fails with error text that contains `Inbox cannot be deleted`
- **WHEN** the client calls `gmail_delete_mailbox` with `name` `Incoming`
- **THEN** the tool call fails with error text that contains `Inbox cannot be deleted`
- **AND** `gmail_list_mailboxes` still contains `Incoming`

#### Scenario: Server refusal leaves the mailbox

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server that lists `Projects`
- **AND** the fake server replies NO to DELETE of `Projects` with a line that contains the fixture password
- **WHEN** an authenticated MCP client calls `gmail_delete_mailbox` with `name` `Projects`
- **THEN** the tool call fails
- **AND** the error text does not contain the fixture password
- **AND** `gmail_list_mailboxes` still contains `Projects`

### Requirement: Gmail move_message tool

The Gmail connector SHALL declare a tool with short name `move_message` (MCP name `gmail_move_message`). Model arguments SHALL include a required `uid` integer greater than or equal to 1, an optional source `mailbox` string that defaults to `INBOX`, and a required destination mailbox string. Model arguments SHALL NOT include a host, a URL, a secret, or a raw IMAP command string. The handler SHALL use the egress TLS session to the IMAP host only. The destination MUST already exist. When it does not, the tool SHALL fail with English error text that contains `Destination mailbox does not exist`, the message SHALL stay in the source, and no MOVE SHALL be sent. When `uid` is missing, is not an integer, or is less than 1, the tool SHALL fail with English error text that contains `uid is required`, the message SHALL stay in the source, and no MOVE SHALL be sent. When the uid is not in the source, the tool SHALL fail with English error text that contains `Message not found` and the message location SHALL stay unchanged. A successful move SHALL remove that uid from the source mailbox. A successful result SHALL be a JSON object with `uid`, `source`, and `destination`, and SHALL NOT include a message body or the account password. Automated tests SHALL use a fake IMAP server and SHALL NOT contact a live mailbox.

#### Scenario: Move message into an existing mailbox

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server
- **AND** `INBOX` contains uid 7 from `alice@example.test` to `me@example.test` with subject `Move me`
- **AND** the folder `Archive` already exists and is empty
- **WHEN** an authenticated MCP client calls `gmail_move_message` with `uid` 7 and `destination` `Archive` and without `mailbox`
- **THEN** the result text parses as a JSON object with `uid` 7, `source` `INBOX`, and `destination` `Archive`
- **AND** the result text does not include a message body and does not contain the account password
- **AND** `gmail_list_messages` on `INBOX` does not include uid 7
- **AND** `gmail_list_messages` on `Archive` includes a summary with subject `Move me`, from `alice@example.test`, and to `me@example.test`

#### Scenario: Missing destination leaves the message in the source

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server whose `INBOX` contains uid 7 and that does not list a folder named `Missing`
- **WHEN** an authenticated MCP client calls `gmail_move_message` with `uid` 7 and `destination` `Missing`
- **THEN** the tool call fails
- **AND** the error text contains `Destination mailbox does not exist`
- **AND** the error text does not contain the account password
- **AND** `gmail_list_messages` on `INBOX` still includes uid 7

#### Scenario: Move uid below 1 is rejected

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server whose `INBOX` contains uid 7 and whose folder `Archive` already exists
- **WHEN** an authenticated MCP client calls `gmail_move_message` with `uid` 0 and `destination` `Archive`
- **THEN** the tool call fails
- **AND** the error text contains `uid is required`
- **AND** the error text does not contain the account password
- **AND** `gmail_list_messages` on `INBOX` still includes uid 7

### Requirement: Gmail copy_message tool

The Gmail connector SHALL declare a tool with short name `copy_message` (MCP name `gmail_copy_message`). Model arguments SHALL include a required `uid` integer greater than or equal to 1, an optional source `mailbox` string that defaults to `INBOX`, and a required destination mailbox string. Model arguments SHALL NOT include a host, a URL, a secret, or a raw IMAP command string. The handler SHALL use the egress TLS session to the IMAP host only and SHALL send UID COPY. The destination MUST already exist. When it does not, the tool SHALL fail with English error text that contains `Destination mailbox does not exist`, the source message SHALL stay, the destination SHALL not gain it, and no COPY SHALL be sent. When `uid` is missing, is not an integer, or is less than 1, the tool SHALL fail with English error text that contains `uid is required` and no COPY SHALL be sent. A successful copy SHALL leave the source uid in place and SHALL add the message to the destination. A successful result SHALL be a JSON object with `uid`, `source`, and `destination`, and SHALL NOT include a message body or the account password. Automated tests SHALL use a fake IMAP server and SHALL NOT contact a live mailbox.

#### Scenario: Copy message keeps the source

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server
- **AND** `INBOX` contains uid 7 from `alice@example.test` to `me@example.test` with subject `Copy me`
- **AND** the folder `Archive` already exists and is empty
- **WHEN** an authenticated MCP client calls `gmail_copy_message` with `uid` 7 and `destination` `Archive` and without `mailbox`
- **THEN** the result text parses as a JSON object with `uid` 7, `source` `INBOX`, and `destination` `Archive`
- **AND** the result text does not include a message body and does not contain the account password
- **AND** `gmail_list_messages` on `INBOX` still includes uid 7
- **AND** `gmail_list_messages` on `Archive` includes a summary with subject `Copy me`, from `alice@example.test`, and to `me@example.test`

#### Scenario: Copy missing destination does not copy

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server whose `INBOX` contains uid 7 and that does not list a folder named `Missing`
- **WHEN** an authenticated MCP client calls `gmail_copy_message` with `uid` 7 and `destination` `Missing`
- **THEN** the tool call fails
- **AND** the error text contains `Destination mailbox does not exist`
- **AND** the error text does not contain the account password
- **AND** `gmail_list_messages` on `INBOX` still includes uid 7

#### Scenario: Copy uid below 1 is rejected

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server whose `INBOX` contains uid 7 and whose folder `Archive` already exists
- **WHEN** an authenticated MCP client calls `gmail_copy_message` with `uid` 0 and `destination` `Archive`
- **THEN** the tool call fails
- **AND** the error text contains `uid is required`
- **AND** the error text does not contain the account password
- **AND** `gmail_list_messages` on `INBOX` still includes uid 7

### Requirement: Gmail delete_message tool

The Gmail connector SHALL declare a tool with short name `delete_message` (MCP name `gmail_delete_message`). Model arguments SHALL include a required `uid` integer greater than or equal to 1 and an optional `mailbox` string that defaults to `INBOX`. Model arguments SHALL NOT include a host, a URL, a secret, or a raw IMAP command string. The handler SHALL MOVE that message into the mailbox whose `specialUse` is `trash`. It SHALL NOT set `\Deleted` and SHALL NOT send EXPUNGE. When LIST has no mailbox with `specialUse` `trash`, the tool SHALL fail with English error text that contains `Trash mailbox is not available` and the message SHALL stay in the source. When `uid` is missing, is not an integer, or is less than 1, the tool SHALL fail with English error text that contains `uid is required` and the message SHALL stay. A successful result SHALL be a JSON object `{ uid, source, destination }` where `destination` is the listed trash name, and SHALL NOT include a message body or the account password. The handler SHALL use the egress TLS session to the IMAP host only. Automated tests SHALL use a fake IMAP server and SHALL NOT contact a live mailbox.

#### Scenario: Delete message moves it into trash

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server
- **AND** `INBOX` contains uid 7 from `alice@example.test` with subject `Delete me`
- **AND** the server lists a mailbox named `Deleted Items` with LIST attribute `\Trash`
- **WHEN** an authenticated MCP client calls `gmail_delete_message` with `uid` 7 and without `mailbox`
- **THEN** the result text parses as a JSON object with `uid` 7, `source` `INBOX`, and `destination` `Deleted Items`
- **AND** `gmail_list_messages` on `INBOX` does not include uid 7
- **AND** `gmail_list_messages` on `Deleted Items` includes a summary with subject `Delete me`
- **AND** the result text does not contain the account password
- **AND** the result text does not contain `[Gmail]/`

#### Scenario: Missing trash leaves the message in place

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server whose `INBOX` contains uid 7 and that lists no mailbox with `\Trash`
- **WHEN** an authenticated MCP client calls `gmail_delete_message` with `uid` 7
- **THEN** the tool call fails
- **AND** the error text contains `Trash mailbox is not available`
- **AND** the error text does not contain the account password
- **AND** `gmail_list_messages` on `INBOX` still includes uid 7

#### Scenario: Delete message uid below 1 is rejected

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server whose `INBOX` contains uid 7 and that lists `Deleted Items` with `\Trash`
- **WHEN** an authenticated MCP client calls `gmail_delete_message` with `uid` 0
- **THEN** the tool call fails
- **AND** the error text contains `uid is required`
- **AND** the error text does not contain the account password
- **AND** `gmail_list_messages` on `INBOX` still includes uid 7

### Requirement: Gmail restore_message tool

The Gmail connector SHALL declare a tool with short name `restore_message` (MCP name `gmail_restore_message`). Model arguments SHALL include a required `uid` integer greater than or equal to 1 and an optional `destination` string that defaults to `INBOX` when omitted, empty, or whitespace. The source SHALL be the mailbox whose `specialUse` is `trash`. Model arguments SHALL NOT include a host, a URL, a secret, or a raw IMAP command string. When LIST has no mailbox with `specialUse` `trash`, the tool SHALL fail with English error text that contains `Trash mailbox is not available`. When the destination does not exist, the tool SHALL fail with English error text that contains `Destination mailbox does not exist` and the message SHALL stay in trash. When `uid` is missing, is not an integer, or is less than 1, the tool SHALL fail with English error text that contains `uid is required` and the message SHALL stay in trash. A successful result SHALL be a JSON object `{ uid, source, destination }` where `source` is the listed trash name. The handler SHALL use the egress TLS session to the IMAP host only. Automated tests SHALL use a fake IMAP server and SHALL NOT contact a live mailbox.

#### Scenario: Restore message moves it out of trash

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server
- **AND** the server lists `Deleted Items` with LIST attribute `\Trash`
- **AND** `Deleted Items` contains a message from `alice@example.test` with subject `Restore me`
- **WHEN** an authenticated MCP client calls `gmail_restore_message` with that message's uid and without `destination`
- **THEN** the result text parses as a JSON object with that `uid`, `source` `Deleted Items`, and `destination` `INBOX`
- **AND** `gmail_list_messages` on `INBOX` includes a summary with subject `Restore me`
- **AND** `gmail_list_messages` on `Deleted Items` does not include that subject
- **AND** the result text does not contain the account password

#### Scenario: Restore without a trash mailbox is rejected

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server whose `INBOX` contains uid 7 and that lists no mailbox with `\Trash`
- **WHEN** an authenticated MCP client calls `gmail_restore_message` with `uid` 7
- **THEN** the tool call fails
- **AND** the error text contains `Trash mailbox is not available`
- **AND** the error text does not contain the account password
- **AND** `gmail_list_messages` on `INBOX` still includes uid 7

#### Scenario: Restore missing destination leaves the message in trash

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server
- **AND** `Deleted Items` has LIST attribute `\Trash` and contains uid 9 with subject `Stay deleted`
- **AND** the server does not list a folder named `Missing`
- **WHEN** an authenticated MCP client calls `gmail_restore_message` with `uid` 9 and `destination` `Missing`
- **THEN** the tool call fails
- **AND** the error text contains `Destination mailbox does not exist`
- **AND** the error text does not contain the account password
- **AND** `gmail_list_messages` on `Deleted Items` still includes the subject `Stay deleted`

#### Scenario: Restore uid below 1 is rejected

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server that lists `Deleted Items` with `\Trash` containing uid 9
- **WHEN** an authenticated MCP client calls `gmail_restore_message` with `uid` 0
- **THEN** the tool call fails
- **AND** the error text contains `uid is required`
- **AND** the error text does not contain the account password
- **AND** `gmail_list_messages` on `Deleted Items` still includes uid 9

### Requirement: Gmail update_flags tool

The Gmail connector SHALL declare a tool with short name `update_flags` (MCP name `gmail_update_flags`). Model arguments SHALL include a required `uid` integer greater than or equal to 1, an optional `mailbox` string that defaults to `INBOX`, an optional boolean `seen`, and an optional boolean `flagged`. At least one of `seen` or `flagged` SHALL be a boolean. When neither is a boolean, the tool SHALL fail with English error text that contains `Flag is required` and SHALL NOT send STORE. True SHALL add the flag, false SHALL remove it, and an omitted flag SHALL stay unchanged. `seen` SHALL be IMAP `\Seen`. `flagged` SHALL be IMAP `\Flagged`. The tool SHALL NOT change other flags, SHALL NOT set `\Deleted`, and SHALL NOT send EXPUNGE. When `uid` is missing, is not an integer, or is less than 1, the tool SHALL fail with English error text that contains `uid is required` and SHALL NOT send STORE. A successful result SHALL be a JSON object `{ uid, seen, flagged }` with the flags after the store, and SHALL NOT include a message body or the account password. The handler SHALL use the egress TLS session to the IMAP host only. Automated tests SHALL use a fake IMAP server and SHALL NOT contact a live mailbox.

#### Scenario: Set seen and flagged

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server whose `INBOX` contains uid 7 that is unseen and not flagged
- **WHEN** an authenticated MCP client calls `gmail_update_flags` with `uid` 7, `seen` true, and `flagged` true
- **THEN** the result text parses as a JSON object with `uid` 7, `seen` true, and `flagged` true
- **AND** a following `gmail_list_messages` summary for uid 7 has `seen` true and `unread` false
- **AND** the result text does not contain the account password

#### Scenario: Clear seen and flagged

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server whose `INBOX` contains uid 7 that is seen and flagged
- **WHEN** an authenticated MCP client calls `gmail_update_flags` with `uid` 7, `seen` false, and `flagged` false
- **THEN** the result text parses as a JSON object with `uid` 7, `seen` false, and `flagged` false
- **AND** a following `gmail_list_messages` summary for uid 7 has `seen` false and `unread` true
- **AND** the result text does not contain the account password

#### Scenario: Omitted flag stays unchanged

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server whose `INBOX` contains uid 7 that is seen and not flagged
- **WHEN** an authenticated MCP client calls `gmail_update_flags` with `uid` 7 and `flagged` true and without `seen`
- **THEN** the result has `uid` 7, `seen` true, and `flagged` true
- **WHEN** the message is flagged and the client calls `gmail_update_flags` with `uid` 7 and `seen` false and without `flagged`
- **THEN** the result has `seen` false and `flagged` true
- **AND** the result text does not contain the account password

#### Scenario: Flag is required

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server whose `INBOX` contains uid 7 that is seen and not flagged
- **WHEN** an authenticated MCP client calls `gmail_update_flags` with `uid` 7 and without `seen` and without `flagged`
- **THEN** the tool call fails
- **AND** the error text contains `Flag is required`
- **AND** the error text does not contain the account password
- **AND** a following `gmail_list_messages` summary for uid 7 has `seen` true and `unread` false
- **WHEN** the client calls `gmail_update_flags` with `uid` 7 and `seen` true and without `flagged`
- **THEN** the result has `flagged` false

#### Scenario: Update flags uid below 1 is rejected

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server whose `INBOX` contains uid 7 that is unseen
- **WHEN** an authenticated MCP client calls `gmail_update_flags` with `uid` 0 and `seen` true
- **THEN** the tool call fails
- **AND** the error text contains `uid is required`
- **AND** the error text does not contain the account password
- **AND** a following `gmail_list_messages` summary for uid 7 has `seen` false

### Requirement: Gmail get_attachment tool

The Gmail connector SHALL declare a tool with short name `get_attachment` (MCP name `gmail_get_attachment`). Model arguments SHALL include a required `uid` integer greater than or equal to 1, an optional `mailbox` string that defaults to `INBOX`, and a required `index` integer greater than or equal to 0. Model arguments SHALL NOT include a host, a URL, a secret, or a raw IMAP command string. When `uid` is missing, is not an integer, or is less than 1, the tool SHALL fail with English error text that contains `uid is required`. When `index` is missing, is not an integer, or is less than 0, the tool SHALL fail with English error text that contains `Attachment index is required` and SHALL NOT fetch. When `index` is an integer greater than or equal to 0 and that attachment part is absent, the tool SHALL fail with English error text that contains `Attachment not found` and the error text SHALL NOT contain the account password. A successful result SHALL be a JSON object `{ index, name, contentType, size, data }` where `data` is standard base64 of the decoded MIME part and `size` is the decoded byte length. The tool SHALL NOT apply a size cap. The handler SHALL use the egress TLS session to the IMAP host only. Automated tests SHALL use a fake IMAP server and SHALL NOT contact a live mailbox.

#### Scenario: Attachment is returned as base64

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server
- **AND** message uid 42 has an attachment index 0 named `file.bin` of content type `application/octet-stream` whose decoded bytes are `file-bytes`
- **WHEN** an authenticated MCP client calls `gmail_get_attachment` with `uid` 42 and `index` 0 and without `mailbox`
- **THEN** the result text parses as a JSON object with `index` 0, `name` `file.bin`, `contentType` `application/octet-stream`, `size` 10, and `data` `ZmlsZS1ieXRlcw==`
- **AND** the result text does not contain the account password

#### Scenario: Missing attachment is not found

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server whose message uid 42 has no attachment
- **WHEN** an authenticated MCP client calls `gmail_get_attachment` with `uid` 42 and `index` 0
- **THEN** the tool call fails
- **AND** the error text contains `Attachment not found`
- **AND** the error text does not contain the account password

#### Scenario: Attachment index below 0 is rejected

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server whose message uid 42 has an attachment at index 0
- **WHEN** an authenticated MCP client calls `gmail_get_attachment` with `uid` 42 and `index` -1
- **THEN** the tool call fails
- **AND** the error text contains `Attachment index is required`
- **AND** the error text does not contain the account password

#### Scenario: Get attachment uid below 1 is rejected

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server whose `INBOX` contains uid 42 with an attachment at index 0
- **WHEN** an authenticated MCP client calls `gmail_get_attachment` with `uid` 0 and `index` 0
- **THEN** the tool call fails
- **AND** the error text contains `uid is required`
- **AND** the error text does not contain the account password
