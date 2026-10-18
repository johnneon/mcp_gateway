# Spec Delta

## REMOVED Requirements

### Requirement: Mail.ru connection check uses IMAP LOGIN and SMTP AUTH over egress

**Reason**: The check required SMTP AUTH after IMAP LOGIN. A mailbox-read application password can pass IMAP LOGIN and fail SMTP AUTH, and the admin API then refuses to save the account. Mail.ru has no send tool.

**Migration**: Use the added requirement `Mail.ru connection check uses IMAP LOGIN over egress`. Success is IMAP LOGIN on `imap.mail.ru:993` only. The check does not open `smtp.mail.ru:465`. A failed IMAP LOGIN still returns exactly `Connection check failed`.

## ADDED Requirements

### Requirement: Mail.ru connection check uses IMAP LOGIN over egress

The Mail.ru connector's `checkConnection` SHALL receive account field values and the gateway-built egress client. It SHALL open a TLS session to `imap.mail.ru:993` and perform IMAP LOGIN with `address` and `password`. It SHALL NOT open a TLS session to `smtp.mail.ru:465` and SHALL NOT perform SMTP AUTH. The check SHALL succeed when that IMAP LOGIN succeeds, including when an SMTP server would reject AUTH for the same credentials. The check SHALL NOT send mail and SHALL NOT speak POP3. Create, a patch that changes label or effective values, and `POST /api/accounts/:id/check` SHALL use this check. Automated tests SHALL use a fake IMAP server behind a fake egress transport and SHALL NOT contact a live mailbox. On failure, the admin API surface remains the fixed plain text `Connection check failed` with no connector exception text, no raw provider line, and no password in the response.

#### Scenario: Successful check when fake IMAP accepts LOGIN

- **GIVEN** the admin app with the Mail.ru connector and a fake egress transport whose TLS sessions to `imap.mail.ru:993` speak to a fake IMAP server that accepts the fixture address and password
- **AND** a TLS session to `smtp.mail.ru:465` would reach a fake SMTP server that rejects AUTH
- **WHEN** the client performs `POST /api/accounts` with connector `mailru`, a non-empty label, and those fixture values
- **THEN** the response status is 201
- **AND** the account is persisted
- **AND** the serialized response body does not contain the fixture password
- **AND** the egress transport opened a TLS session to `imap.mail.ru:993`
- **AND** the egress transport did not open a TLS session to `smtp.mail.ru:465`

#### Scenario: Failed check when fake IMAP rejects login

- **GIVEN** the admin app with the Mail.ru connector and a fake egress transport whose fake IMAP server rejects LOGIN
- **WHEN** the client performs `POST /api/accounts` with connector `mailru` and otherwise valid values including a fixture password
- **THEN** the response status is 400
- **AND** the response body is exactly the plain text `Connection check failed`
- **AND** the serialized response body does not contain the fixture password
- **AND** the account is not saved
- **AND** the egress transport did not open a TLS session to `smtp.mail.ru:465`

#### Scenario: Explicit check succeeds after IMAP LOGIN only

- **GIVEN** a persisted Mail.ru account and a fake egress transport whose fake IMAP server accepts that account's address and password
- **AND** a TLS session to `smtp.mail.ru:465` would reach a fake SMTP server that rejects AUTH
- **WHEN** the client performs `POST /api/accounts/:id/check` for that account
- **THEN** the response status is 200
- **AND** the response body does not contain the fixture password
- **AND** the stored account is unchanged
- **AND** the egress transport did not open a TLS session to `smtp.mail.ru:465`

#### Scenario: Credential patch succeeds after IMAP LOGIN only

- **GIVEN** a persisted Mail.ru account and a fake egress transport whose fake IMAP server accepts a new fixture password
- **AND** a TLS session to `smtp.mail.ru:465` would reach a fake SMTP server that rejects AUTH
- **WHEN** the client performs `PATCH /api/accounts/:id` with `values.password` set to that new fixture password
- **THEN** the response status is 200
- **AND** the stored password is the new fixture password
- **AND** the serialized response body does not contain the fixture password
- **AND** the egress transport did not open a TLS session to `smtp.mail.ru:465`

## MODIFIED Requirements

### Requirement: Mail.ru uses the shared mail protocol module

The Mail.ru connector SHALL supply hosts, field mapping, connection check, and tools, and SHALL perform IMAP operations only through the existing shared mail module over an already-connected egress duplex. `checkConnection` and Mail.ru tools SHALL NOT open an SMTP session. The connector SHALL NOT embed a second IMAP stack and SHALL NOT open a TCP or TLS socket outside the egress client. Automated tests SHALL use a fake IMAP server and SHALL NOT contact a live Mail.ru mailbox.

#### Scenario: Mail.ru login uses the shared module over the egress duplex

- **GIVEN** a fake egress client that returns a duplex connected to a fake IMAP server for `imap.mail.ru:993` and that would return a duplex connected to a fake SMTP server for `smtp.mail.ru:465`
- **WHEN** the Mail.ru connector `checkConnection` runs with fixture address and password that the fake IMAP server accepts
- **THEN** IMAP LOGIN succeeds
- **AND** the only TLS session opened is to `imap.mail.ru:993`
- **AND** no TLS session is opened to `smtp.mail.ru:465`
- **AND** the connector did not open a TCP or TLS socket outside that egress client
