# Spec Delta

## Purpose

Defines the native Gmail connector: mailbox credentials, constant IMAP and SMTP hosts, connection check over the egress TLS session, and MCP tools that list, search, and read messages without exposing the app password or contacting a live mailbox in tests.

## ADDED Requirements

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

The Gmail connector SHALL declare a tool with short name `list_messages` (MCP name `gmail_list_messages`). Model arguments SHALL include an optional `mailbox` string that defaults to `INBOX` when omitted, and a `limit` integer capped by a code constant. The handler SHALL use the egress TLS session to the IMAP host only. The result SHALL be a summary list of messages with fields `uid`, `from`, `subject`, `date`, and seen/unread state, and SHALL NOT include message bodies. Model arguments SHALL NOT contain a URL, a host, a secret, or a raw IMAP command string.

#### Scenario: List returns capped summaries without bodies on a fake IMAP server

- **GIVEN** an enabled configuration whose `accountIds` include an enabled Gmail account, and the MCP app with a fake egress transport backed by a fake IMAP server that has more messages in `INBOX` than the cap
- **AND** the plaintext bearer of that configuration is known to the test
- **WHEN** an MCP client authenticates with that bearer and calls `gmail_list_messages` with `limit` at or above the cap and without `mailbox`
- **THEN** the tool result lists at most the capped number of summaries
- **AND** each summary includes `uid`, `from`, `subject`, `date`, and seen/unread state
- **AND** no summary includes a message body
- **AND** the result text does not contain the account password

### Requirement: Gmail search_messages tool

The Gmail connector SHALL declare a tool with short name `search_messages` (MCP name `gmail_search_messages`). Model arguments SHALL include an optional `mailbox` string defaulting to `INBOX` and a narrow filter object whose only allowed keys are `unseen` (boolean), `from` (string), `subject` (string substring), and `since` (date string). The handler SHALL reject a free-form IMAP search string or any filter key outside that set. Successful results SHALL use the same summary shape as `list_messages` (uid, from, subject, date, seen/unread) and SHALL NOT include bodies. Model arguments SHALL NOT contain a URL, a host, a secret, or a raw IMAP command string.

#### Scenario: Narrow filter search returns matching summaries on a fake IMAP server

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server with messages from `alice@example.test` and from another address
- **WHEN** an authenticated MCP client calls `gmail_search_messages` with filter `{ "from": "alice@example.test" }`
- **THEN** the tool result summaries include only messages matching that from filter
- **AND** each summary has the list_messages summary shape without a body
- **AND** the result text does not contain the account password

#### Scenario: Free-form IMAP search syntax is rejected

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server
- **WHEN** an authenticated MCP client calls `gmail_search_messages` with a free-form search string argument or a filter key outside `unseen`, `from`, `subject`, and `since`
- **THEN** the tool call fails without issuing that free-form search to the fake IMAP server
- **AND** the error text does not contain the account password

### Requirement: Gmail read_message tool

The Gmail connector SHALL declare a tool with short name `read_message` (MCP name `gmail_read_message`). Model arguments SHALL include an optional `mailbox` string defaulting to `INBOX` and a required `uid`. The handler SHALL return headers `from`, `to`, `subject`, and `date`, and the text body. The handler SHALL NOT return attachment bytes. Attachment names MAY be included when available without fetching attachment payloads. Model arguments SHALL NOT contain a URL, a host, a secret, or a raw IMAP command string.

#### Scenario: Read returns headers and text body without attachment bytes

- **GIVEN** an eligible Gmail account on an enabled configuration and a fake IMAP server with a message that has a text body and a named attachment
- **WHEN** an authenticated MCP client calls `gmail_read_message` with that message's `uid`
- **THEN** the tool result includes headers `from`, `to`, `subject`, and `date`, and the text body
- **AND** the result does not include attachment file bytes
- **AND** the result text does not contain the account password

### Requirement: Shared mail protocol is separate from the Gmail connector

IMAP and SMTP protocol logic SHALL live in a shared module that speaks only over an already-connected egress duplex and accepts host and credential mapping from the caller. The Gmail connector SHALL supply hosts, field mapping, connection check, and tools, and SHALL NOT embed a second IMAP/SMTP stack. Automated tests of the shared module SHALL use fake IMAP and fake SMTP servers and SHALL NOT contact a live provider. This change SHALL NOT register a Mail.ru connector.

#### Scenario: Shared module authenticates over a duplex without opening its own TCP socket

- **GIVEN** a fake duplex connected to a fake IMAP server that accepts LOGIN
- **WHEN** the shared mail module performs IMAP LOGIN over that duplex with fixture credentials
- **THEN** LOGIN succeeds
- **AND** the module did not open a separate TCP or TLS socket outside the provided duplex

### Requirement: Password never appears in Gmail tool or admin surfaces

The Gmail app password SHALL NOT appear in tool result text, MCP error text, or admin API response bodies for create, patch, check, list, or get-account paths that involve a Gmail account. Tests SHALL use a fixture password string and assert it is absent from those serialized bodies after scrubbing and fixed error mapping.

#### Scenario: Fixture password absent from tool result and MCP error

- **GIVEN** an eligible Gmail account whose `password` field is a fixture secret, and a fake IMAP path that either returns a successful list or throws an error whose message contains that fixture secret
- **WHEN** an authenticated MCP client calls `gmail_list_messages` for each case
- **THEN** neither the successful result text nor the MCP error text contains the fixture secret
