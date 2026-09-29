# Spec Delta

## ADDED Requirements

### Requirement: TLS session operation returns an open duplex

The egress client SHALL expose a TLS session operation that accepts `host` and `port`, performs the allowlist check before any I/O, establishes a TLS connection through the injectable transport, and returns a duplex suitable for reading and writing application bytes. The session SHALL remain open for the caller to use; the client SHALL NOT call `end` on the duplex as part of establishing the session. Production timeout SHALL remain 30 seconds and maximum size SHALL remain 64 MiB (67108864 bytes), injectable in tests. Model arguments SHALL NOT carry a URL, host, or secret for this operation. Tests SHALL inject a fake transport and SHALL NOT contact a live provider.

#### Scenario: TLS session to an allowed destination returns an open duplex once

- **GIVEN** an egress client allowlisted for `{ host: "imap.example.test", port: 993 }` and a fake transport that records TLS session parameters and returns a fake duplex
- **WHEN** the client opens a TLS session to host `imap.example.test` and port `993`
- **THEN** the fake transport is invoked exactly once with that host and port
- **AND** the returned duplex is open for further read and write by the caller
- **AND** establishing the session does not end the duplex

#### Scenario: Disallowed TLS session leaves transport call count at zero

- **GIVEN** an egress client whose resolved allowlist is only `{ host: "imap.example.test", port: 993 }` and a fake transport whose call count starts at 0
- **WHEN** the client is asked to open a TLS session to `{ host: "evil.example.test", port: 993 }`
- **THEN** the operation fails with message exactly `Destination is not allowed`
- **AND** the fake transport call count equals 0

## MODIFIED Requirements

### Requirement: Resolve allowed destinations for an account

The process SHALL resolve the connector's `allowedDestinations` into a concrete set of `{host, port}` pairs for a given account by taking each constant `{host, port}` as declared and each `{field, port}` from the non-empty value of the named account field of type `host`. Hostname comparison against that set SHALL be case-insensitive. The production connector registry MAY include product connectors; tests SHALL inject a fake connector when asserting resolution for a non-product shape.

#### Scenario: Constant and field-backed destinations resolve for an account

- **GIVEN** a fake native connector with a `host` field named `mailhost` and allowed destinations `[{ host: "imap.example.test", port: 993 }, { field: "mailhost", port: 465 }]`
- **AND** an account whose `mailhost` value is `Smtp.Example.Test`
- **WHEN** the egress allowlist is resolved for that connector and account
- **THEN** the resolved set includes `{ host: "imap.example.test", port: 993 }` and `{ host: "Smtp.Example.Test", port: 465 }` for case-insensitive host matching

### Requirement: HTTPS request and TLS connect operations

The egress client SHALL expose allowlist-checked network operations including: an HTTPS request that accepts `host`, `port`, `method`, `path`, `headers`, and `body` and SHALL NOT accept a URL argument; a TLS connect that accepts `host` and `port` and completes a handshake then ends the socket (handshake-only); and a TLS session that returns an open duplex as defined by the TLS session requirement. The client SHALL NOT provide plain HTTP. The client SHALL NOT be limited to exactly two operations. Model arguments SHALL NOT carry a URL, host, or secret for these operations. Tests SHALL inject a fake transport and SHALL NOT contact a live provider.

#### Scenario: HTTPS request to an allowed destination uses the fake transport once

- **GIVEN** an egress client allowlisted for `{ host: "api.example.test", port: 443 }` and a fake transport that records the HTTPS parameters it receives
- **WHEN** the client performs an HTTPS request with host `api.example.test`, port `443`, method `GET`, path `/v1/ping`, empty headers, and empty body
- **THEN** the fake transport is invoked exactly once with those parameters
- **AND** the operation does not accept or require a URL string argument

#### Scenario: TLS connect to an allowed destination uses the fake transport once

- **GIVEN** an egress client allowlisted for `{ host: "imap.example.test", port: 993 }` and a fake transport that records TLS connect parameters
- **WHEN** the client performs a TLS connect to host `imap.example.test` and port `993`
- **THEN** the fake transport is invoked exactly once with that host and port

#### Scenario: Handshake tlsConnect still ends the socket after connect

- **GIVEN** an egress client allowlisted for `{ host: "imap.example.test", port: 993 }` and a fake transport that records whether the handshake-only TLS connect ends the socket
- **WHEN** the client performs the handshake-only TLS connect to that host and port
- **THEN** the fake transport records that the handshake path ended the socket
- **AND** that path is distinct from the TLS session path that leaves a duplex open
