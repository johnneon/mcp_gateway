# connector-mail-ru Specification

## Purpose

Defines the native Mail.ru connector: mailbox credentials, constant IMAP and SMTP hosts, connection check over the egress TLS session, and MCP tools that list, search, and read messages without exposing the app password or contacting a live mailbox in tests.

## Requirements

### Requirement: Mail.ru connector module identity and fields

The process SHALL register a native connector with `id` exactly `mailru`, display `name` exactly `Mail.ru`, and `kind` exactly `native`. The connector SHALL declare exactly these account fields: `address` with type `text`, `required` true, and English label `Address`; and `password` with type `secret`, `required` true, and English label `App password`. The connector SHALL declare `allowedDestinations` as the constant pairs `{ host: "imap.mail.ru", port: 993 }` and `{ host: "smtp.mail.ru", port: 465 }` and SHALL NOT take hosts from model arguments or from account fields of type `host`.

#### Scenario: Production registry lists Mail.ru with Address and App password fields

- **GIVEN** the production connector registry module
- **WHEN** its public connector list is read
- **THEN** the list includes a connector with `id` `mailru`, `name` `Mail.ru`, and `kind` `native`
- **AND** that connector's fields include `{ name: "address", label: "Address", type: "text", required: true }` and `{ name: "password", label: "App password", type: "secret", required: true }`
- **AND** the list still includes a connector with `id` `gmail`

#### Scenario: Mail.ru allowlist is the two constant hosts

- **GIVEN** the Mail.ru connector module from the production registry
- **WHEN** its `allowedDestinations` are read
- **THEN** they are exactly `{ host: "imap.mail.ru", port: 993 }` and `{ host: "smtp.mail.ru", port: 465 }`

### Requirement: Mail.ru connection check uses IMAP LOGIN and SMTP AUTH over egress

The Mail.ru connector's `checkConnection` SHALL receive account field values and the gateway-built egress client. It SHALL open a TLS session to `imap.mail.ru:993` and perform IMAP LOGIN with `address` and `password`, and SHALL open a TLS session to `smtp.mail.ru:465` and perform SMTP AUTH with the same credentials. The check SHALL succeed only when both authentications succeed. The check SHALL NOT send mail. Automated tests SHALL use a fake IMAP server and a fake SMTP server behind a fake egress transport and SHALL NOT contact a live mailbox. On failure, the admin API surface remains the fixed plain text `Connection check failed` with no connector exception text and no password in the response.

#### Scenario: Successful check when fake IMAP and SMTP both accept login

- **GIVEN** the admin app with the Mail.ru connector and a fake egress transport whose TLS sessions speak to a fake IMAP server and a fake SMTP server that both accept the fixture address and password
- **WHEN** the client performs `POST /api/accounts` with connector `mailru`, a non-empty label, and those fixture values
- **THEN** the response status is 201
- **AND** the account is persisted
- **AND** the serialized response body does not contain the fixture password

#### Scenario: Failed check when fake IMAP rejects login

- **GIVEN** the admin app with the Mail.ru connector and a fake egress transport whose fake IMAP server rejects LOGIN while the fake SMTP server would accept AUTH
- **WHEN** the client performs `POST /api/accounts` with connector `mailru` and otherwise valid values including a fixture password
- **THEN** the response status is 400
- **AND** the response body is exactly the plain text `Connection check failed`
- **AND** the serialized response body does not contain the fixture password
- **AND** the account is not saved

#### Scenario: Failed check when fake SMTP rejects AUTH

- **GIVEN** the admin app with the Mail.ru connector and a fake egress transport whose fake IMAP server accepts LOGIN and whose fake SMTP server rejects AUTH
- **WHEN** the client performs `POST /api/accounts` with connector `mailru` and otherwise valid values including a fixture password
- **THEN** the response status is 400
- **AND** the response body is exactly the plain text `Connection check failed`
- **AND** the serialized response body does not contain the fixture password
- **AND** the account is not saved

### Requirement: Mail.ru list_messages tool

The Mail.ru connector SHALL declare a tool with short name `list_messages` (MCP name `mailru_list_messages`). Model arguments SHALL include an optional `mailbox` string that defaults to `INBOX` when omitted, and a `limit` integer capped by a code constant. The omitted limit SHALL default to 20. The maximum limit SHALL be 50. The handler SHALL use the egress TLS session to the IMAP host only. The result SHALL be a summary list of messages with fields `uid`, `from`, `subject`, `date`, and seen/unread state, and SHALL NOT include message bodies. Model arguments SHALL NOT contain a URL, a host, a secret, or a raw IMAP command string.

#### Scenario: List returns capped summaries without bodies on a fake IMAP server

- **GIVEN** an enabled configuration whose `accountIds` include an enabled Mail.ru account, and the MCP app with a fake egress transport backed by a fake IMAP server that has more messages in `INBOX` than the cap
- **AND** the plaintext bearer of that configuration is known to the test
- **WHEN** an MCP client authenticates with that bearer and calls `mailru_list_messages` with `limit` at or above the cap and without `mailbox`
- **THEN** the tool result lists at most 50 summaries
- **AND** each summary includes `uid`, `from`, `subject`, `date`, and seen/unread state
- **AND** no summary includes a message body
- **AND** the result text does not contain the account password

### Requirement: Mail.ru search_messages tool

The Mail.ru connector SHALL declare a tool with short name `search_messages` (MCP name `mailru_search_messages`). Model arguments SHALL include an optional `mailbox` string defaulting to `INBOX` and a narrow filter object whose only allowed keys are `unseen` (boolean), `from` (string), `subject` (string substring), and `since` (date string). The handler SHALL reject a free-form IMAP search string or any filter key outside that set. Successful results SHALL use the same summary shape as `list_messages` (uid, from, subject, date, seen/unread) and SHALL NOT include bodies. Model arguments SHALL NOT contain a URL, a host, a secret, or a raw IMAP command string.

#### Scenario: Narrow filter search returns matching summaries on a fake IMAP server

- **GIVEN** an eligible Mail.ru account on an enabled configuration and a fake IMAP server with messages from `alice@example.test` and from another address
- **WHEN** an authenticated MCP client calls `mailru_search_messages` with filter `{ "from": "alice@example.test" }`
- **THEN** the tool result summaries include only messages matching that from filter
- **AND** each summary has the list_messages summary shape without a body
- **AND** the result text does not contain the account password

#### Scenario: Free-form IMAP search syntax is rejected

- **GIVEN** an eligible Mail.ru account on an enabled configuration and a fake IMAP server
- **WHEN** an authenticated MCP client calls `mailru_search_messages` with a free-form search string argument or a filter key outside `unseen`, `from`, `subject`, and `since`
- **THEN** the tool call fails without issuing that free-form search to the fake IMAP server
- **AND** the error text does not contain the account password

### Requirement: Mail.ru read_message tool

The Mail.ru connector SHALL declare a tool with short name `read_message` (MCP name `mailru_read_message`). Model arguments SHALL include an optional `mailbox` string defaulting to `INBOX` and a required `uid`. The handler SHALL return headers `from`, `to`, `subject`, and `date`, and the text body. The handler SHALL NOT return attachment bytes. Attachment names MAY be included when available without fetching attachment payloads. Model arguments SHALL NOT contain a URL, a host, a secret, or a raw IMAP command string.

#### Scenario: Read returns headers and text body without attachment bytes

- **GIVEN** an eligible Mail.ru account on an enabled configuration and a fake IMAP server with a message that has a text body and a named attachment
- **WHEN** an authenticated MCP client calls `mailru_read_message` with that message's `uid`
- **THEN** the tool result includes headers `from`, `to`, `subject`, and `date`, and the text body
- **AND** the result does not include attachment file bytes
- **AND** the result text does not contain the account password

### Requirement: Mail.ru uses the shared mail protocol module

The Mail.ru connector SHALL supply hosts, field mapping, connection check, and tools, and SHALL perform IMAP and SMTP operations only through the existing shared mail module over an already-connected egress duplex. It SHALL NOT embed a second IMAP/SMTP stack and SHALL NOT open a TCP or TLS socket outside the egress client. Automated tests SHALL use fake IMAP and fake SMTP servers and SHALL NOT contact a live Mail.ru mailbox.

#### Scenario: Mail.ru login uses the shared module over the egress duplex

- **GIVEN** a fake egress client that returns a duplex connected to a fake IMAP server for `imap.mail.ru:993` and a duplex connected to a fake SMTP server for `smtp.mail.ru:465`
- **WHEN** the Mail.ru connector `checkConnection` runs with fixture address and password that both fakes accept
- **THEN** IMAP LOGIN and SMTP AUTH both succeed
- **AND** the connector did not open a TCP or TLS socket outside that egress client

### Requirement: Password never appears in Mail.ru tool or admin surfaces

The Mail.ru app password SHALL NOT appear in tool result text, MCP error text, or admin API response bodies for create, patch, check, list, or get-account paths that involve a Mail.ru account. Tests SHALL use a fixture password string and assert it is absent from those serialized bodies after scrubbing and fixed error mapping.

#### Scenario: Fixture password absent from tool result and MCP error

- **GIVEN** an eligible Mail.ru account whose `password` field is a fixture secret, and a fake IMAP path that either returns a successful list or throws an error whose message contains that fixture secret
- **WHEN** an authenticated MCP client calls `mailru_list_messages` for each case
- **THEN** neither the successful result text nor the MCP error text contains the fixture secret
