# Design

## Context

See `proposal.md` — Why. Native tools already dispatch through `dispatchToolCall` in `server/src/mcp/call.ts`: Ajv validation, account authorization, handler `(args, accountValues)`, and a catch-all that maps any throw to `Tool execution failed`. The connector contract already declares `allowedDestinations` as constant `{host, port}` or `{field, port}` and ships an empty production registry. Vision: `mcp-gateway-spec.md` (native handler receives a client limited to allowed hosts; do not follow a redirect to another host; timeout and size limit are code constants; strip secret values from the response and from error text; client error is short, English, without headers or bodies). This change is stricter than the vision on redirects: **no redirect at all**. Accepted decisions below are not reopened.

## Goals / Non-Goals

**Goals:**

- Gateway-built egress client per account call, allowlist from connector destinations, HTTPS + TLS only, no redirects, injectable transport/limits for tests.
- Handler signature gains the client; `checkConnection` unchanged in this change.
- Distinct short English network errors; secret scrubbing on result text and error text before the MCP client sees them.

**Non-Goals:**

- Gmail connector, proxy kind, call log, admin UI.
- Passing the egress client into `checkConnection` (deferred to the Gmail change).
- Edits to `mcp-gateway-spec.md` or `openspec/specs/` during apply.

## Decisions

Accepted by the person before propose; they are not reopened here. No open questions remain for this change.

### 1. Handler receives egress client; checkConnection does not

- Extend `NativeToolHandler` to `(args, accountValues, egressClient)`.
- `dispatchToolCall` builds the client for the authorized account and passes it on every successful invoke path.
- `checkConnection` keeps `(accountValues)` only. Gmail (later) will use the same client for connection checks then.

**Alternative (rejected):** pass the client into `checkConnection` now — deferred; person locked unchanged checkConnection in this change.

### 2. Allowlist resolution and case-insensitive host match

- Resolve `allowedDestinations`: constant `{host, port}` as declared; `{field, port}` from the account field of type `host` (use the stored field value as the hostname).
- Compare hostnames case-insensitively when checking a requested host:port against the resolved list.
- Port must match exactly.
- Disallowed pair: do not call the transport (call count stays 0); error `Destination is not allowed`.

**Alternative (rejected):** DNS-based allowlisting or IP literals from model args — rejected; hosts come only from connector code or operator-entered host fields.

### 3. Two operations; fake transport; empty production registry

- Operations: (1) HTTPS request — parameters `host`, `port`, `method`, `path`, `headers`, `body`; no URL argument; no plain HTTP. (2) TLS connect — `host`, `port` (for later IMAP/SMTP).
- Production path uses real TLS/HTTPS under the hood behind a narrow transport interface.
- Tests inject a fake connector and a fake transport; no live provider. Production registry stays empty.

**Alternative (rejected):** single generic "request URL" API — rejected; model must not supply URL/host; connector code chooses host from allowlist.

### 4. Never follow any redirect

- HTTPS fetch uses `redirect: 'manual'` (or equivalent).
- Any 3xx → error exactly `Redirect is not allowed`. One request only. Do not read or return `Location` or the response body.
- Stricter than vision ("do not follow a redirect to another host"): same-host redirects are also refused.

**Alternative (rejected):** follow same-host redirects — rejected; person locked no redirect at all.

### 5. Timeout and max size as code constants; injectable in tests

- Production: timeout **30 seconds**, max response size **1 MiB (1048576 bytes)**.
- Factory/dependencies accept overrides so tests inject smaller values. No real sleeps in tests (fake abort / oversized stream).
- Timeout or abort → `Connection failed`.
- Oversized body → abort the read; do not return a truncated body; error `Response too large`.

### 6. Distinct network errors vs generic tool failure

- Egress phrases: `Destination is not allowed`, `Redirect is not allowed`, `Connection failed`, `Response too large`.
- These are distinct from `Tool execution failed`. No response headers or bodies in the message.
- `dispatchToolCall` recognizes these phrases (typed error or exact message) and rethrows/maps them to the MCP client unchanged (after secret scrubbing).
- Any other thrown handler error still becomes the fixed English `Tool execution failed` with no exception text.

**Alternative (rejected):** fold all egress failures into `Tool execution failed` — rejected; person locked distinct phrases.

### 7. Secret scrubbing before the MCP client sees results or errors

- Collect non-empty account field values whose field type is `secret`.
- For each text content part of a successful tool result: replace every occurrence of those values with `[redacted]`. Replace **longer** secret values first (so a longer secret that contains a shorter one is fully redacted).
- Empty secret values: leave unchanged (do not insert `[redacted]` for empty).
- Do not redact `text`, `host`, or other non-secret field values.
- Apply the same replacement to MCP error text before it reaches the client (defense in depth; fixed egress phrases already exclude bodies).

**Alternative (rejected):** scrub only successful results — rejected; person locked scrubbing of error text as well.

### 8. Verification on fake transport only

- Automated scenarios: connection abort → `Connection failed`; oversized response → `Response too large`; redirect (including foreign host) → `Redirect is not allowed`; secret returned in body → `[redacted]` in the MCP result.
- No admin UI change → no browser pass for screens in this change's apply contract.

## Risks / Trade-offs

- [Handler signature **BREAKING** for any in-tree fake handlers] → Mitigation: only test fakes exist today; update them in the same tasks; production registry empty.
- [Substring redaction of short secrets can over-redact common substrings] → Mitigation: only non-empty secret field values; longer-first order; empty secrets skipped; acceptable for defense in depth.
- [Recognizing egress errors by message string] → Mitigation: prefer a small typed error class with a stable `code`/`message` pair exported from the egress module; map by type first, message second.
- [Node fetch redirect defaults] → Mitigation: explicitly set `redirect: 'manual'`; assert one transport call and exact error in tests.

## Migration Plan

- Single process restart after merge; no store document migration.
- Rollback: revert the change branch / PR.

## Open Questions

None. The accepted decisions above lock handler vs checkConnection, allowlist resolution and case-insensitive host match, HTTPS + TLS only with fake transport, no redirects at all, timeout/size constants and injectable test limits, distinct English network errors, secret scrubbing (longer first, empty unchanged, errors included), and fake-only verification without a browser pass.
