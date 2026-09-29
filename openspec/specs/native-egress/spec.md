# native-egress Specification

## Purpose

Defines the gateway-built egress client for native connector tools: allowlist resolution from connector destinations, HTTPS and TLS operations only, redirect refusal, timeout and size limits, and short English network errors verifiable on a fake transport.

## Requirements

### Requirement: Resolve allowed destinations for an account

The process SHALL resolve the connector's `allowedDestinations` into a concrete set of `{host, port}` pairs for a given account by taking each constant `{host, port}` as declared and each `{field, port}` from the non-empty value of the named account field of type `host`. Hostname comparison against that set SHALL be case-insensitive. The production connector registry SHALL remain empty; tests SHALL inject a fake connector when asserting resolution.

#### Scenario: Constant and field-backed destinations resolve for an account

- **GIVEN** a fake native connector with a `host` field named `mailhost` and allowed destinations `[{ host: "imap.example.test", port: 993 }, { field: "mailhost", port: 465 }]`
- **AND** an account whose `mailhost` value is `Smtp.Example.Test`
- **WHEN** the egress allowlist is resolved for that connector and account
- **THEN** the resolved set includes `{ host: "imap.example.test", port: 993 }` and `{ host: "Smtp.Example.Test", port: 465 }` for case-insensitive host matching

### Requirement: Egress client refuses disallowed destinations before I/O

The egress client SHALL refuse a host:port pair that is not in the resolved allowlist and SHALL NOT call the underlying transport for that attempt. The refusal error message SHALL be exactly `Destination is not allowed`. Tests SHALL inject a fake transport whose call count starts at 0.

#### Scenario: Disallowed host:port leaves transport call count at zero

- **GIVEN** an egress client whose resolved allowlist is only `{ host: "imap.example.test", port: 993 }` and a fake transport whose call count starts at 0
- **WHEN** the client is asked to perform an HTTPS request or TLS connect to `{ host: "evil.example.test", port: 443 }`
- **THEN** the operation fails with message exactly `Destination is not allowed`
- **AND** the fake transport call count equals 0

#### Scenario: Allowed destination is case-insensitive on hostname

- **GIVEN** an egress client whose resolved allowlist includes `{ host: "imap.example.test", port: 993 }` and a fake transport whose call count starts at 0
- **WHEN** the client is asked to TLS-connect to `{ host: "IMAP.Example.TEST", port: 993 }`
- **THEN** the fake transport is invoked exactly once for that attempt

### Requirement: HTTPS request and TLS connect operations

The egress client SHALL expose exactly two network operations, both allowlist-checked before any I/O: an HTTPS request that accepts `host`, `port`, `method`, `path`, `headers`, and `body` and SHALL NOT accept a URL argument; and a TLS connect that accepts `host` and `port`. The client SHALL NOT provide plain HTTP. Model arguments SHALL NOT carry a URL, host, or secret for these operations. Tests SHALL inject a fake transport and SHALL NOT contact a live provider.

#### Scenario: HTTPS request to an allowed destination uses the fake transport once

- **GIVEN** an egress client allowlisted for `{ host: "api.example.test", port: 443 }` and a fake transport that records the HTTPS parameters it receives
- **WHEN** the client performs an HTTPS request with host `api.example.test`, port `443`, method `GET`, path `/v1/ping`, empty headers, and empty body
- **THEN** the fake transport is invoked exactly once with those parameters
- **AND** the operation does not accept or require a URL string argument

#### Scenario: TLS connect to an allowed destination uses the fake transport once

- **GIVEN** an egress client allowlisted for `{ host: "imap.example.test", port: 993 }` and a fake transport that records TLS connect parameters
- **WHEN** the client performs a TLS connect to host `imap.example.test` and port `993`
- **THEN** the fake transport is invoked exactly once with that host and port

### Requirement: Never follow redirects

An HTTPS request SHALL use redirect mode that does not follow redirects (`redirect: manual`). The client SHALL NOT follow any redirect, including a redirect to the same allowed host. On a 3xx response the client SHALL fail with message exactly `Redirect is not allowed`, SHALL perform only that one request, and SHALL NOT read or return the `Location` header or the response body.

#### Scenario: Redirect to a foreign host is refused without following

- **GIVEN** an egress client allowlisted for `{ host: "api.example.test", port: 443 }` and a fake transport that returns status `302` with a `Location` header pointing at `https://evil.example.test/x` and a non-empty body
- **WHEN** the client performs an HTTPS request to the allowlisted host
- **THEN** the operation fails with message exactly `Redirect is not allowed`
- **AND** the fake transport was invoked exactly once
- **AND** the error text does not contain the Location URL or the response body

#### Scenario: Redirect to the same allowed host is still refused

- **GIVEN** an egress client allowlisted for `{ host: "api.example.test", port: 443 }` and a fake transport that returns status `301` with `Location` pointing at the same host
- **WHEN** the client performs an HTTPS request to that host
- **THEN** the operation fails with message exactly `Redirect is not allowed`
- **AND** the fake transport was invoked exactly once

### Requirement: Timeout and max response size constants

In production the egress client SHALL use a timeout of 30 seconds and a maximum response body size of 64 MiB (67108864 bytes). Tests SHALL inject smaller timeout and max-size values through dependencies and SHALL NOT use real sleeps. On timeout or abort the client SHALL fail with message exactly `Connection failed`. When the response body would exceed the max size the client SHALL abort the read, SHALL NOT return a truncated body, and SHALL fail with message exactly `Response too large`.

#### Scenario: Injected abort yields Connection failed

- **GIVEN** an egress client with an injected fake transport that aborts the connection before completing the response
- **WHEN** the client performs an HTTPS request to an allowlisted destination
- **THEN** the operation fails with message exactly `Connection failed`
- **AND** the error text contains no response headers and no response body

#### Scenario: Oversized response yields Response too large without truncated body

- **GIVEN** an egress client with an injected max response size smaller than a fake transport body that exceeds that limit
- **WHEN** the client performs an HTTPS request to an allowlisted destination
- **THEN** the operation fails with message exactly `Response too large`
- **AND** the client does not return a truncated body to the caller
- **AND** the error text contains no response headers and no response body bytes

### Requirement: Network errors are short English phrases without bodies

Egress network failure messages SHALL be the distinct short English phrases defined by this capability (`Destination is not allowed`, `Redirect is not allowed`, `Connection failed`, `Response too large`). Those messages SHALL NOT include response headers or response bodies. They SHALL NOT be the generic MCP phrase `Tool execution failed`.

#### Scenario: Fake transport returning a secret in the body does not leak it on redirect refusal

- **GIVEN** an egress client allowlisted for one host and a fake transport that returns status `302` with a response body containing a fixture secret string
- **WHEN** the client performs an HTTPS request
- **THEN** the operation fails with message exactly `Redirect is not allowed`
- **AND** the error text does not contain the fixture secret string
