# Proposal

Issue: #16

## Why

Native tools can already run with decrypted account values, but nothing yet stops a handler from calling an arbitrary host or leaking a secret in a tool result. Without a gateway-built egress client limited to the connector's allowed destinations, and without scrubbing secret field values before the MCP client sees text, a compromised or buggy connector path can exfiltrate credentials or open the process to untrusted network targets.

## What Changes

- The gateway builds an egress client for the selected account from the connector's `allowedDestinations` (constant `{host, port}` and `{field, port}` from account fields of type `host`). Hostname comparison is case-insensitive. A request to a host:port pair outside that resolved list is refused before any transport I/O (call count stays 0).
- The native tool handler signature gains that egress client as a third argument. `checkConnection` is unchanged in this change and does not receive the client.
- The client exposes two allowlist-checked operations: HTTPS request (host, port, method, path, headers, body — no URL argument) and TLS connect (host, port) for later IMAP/SMTP. No plain HTTP. No URL, host, or secret in model arguments. Production registry stays empty; tests inject a fake connector and a fake transport. No live provider.
- Redirects are never followed, including a redirect to the same allowed host (`redirect: manual`). A 3xx response becomes the short English error `Redirect is not allowed` without reading Location or the response body. One request only.
- Production constants in code: timeout 30 seconds, max response size 64 MiB (67108864 bytes). Tests inject smaller values through dependencies. No real sleeps. Timeout or abort → `Connection failed`. Oversized body → abort the read, do not return a truncated body, error `Response too large`. Disallowed destination → `Destination is not allowed`.
- These network errors are distinct short English phrases, not the existing generic `Tool execution failed`. They contain no response headers and no response body. A thrown handler error still becomes a fixed English message with no exception text.
- Before the MCP client sees a tool result, every non-empty account field value of type `secret` is replaced with `[redacted]` in each text content part (longer secret values first). Empty secret values are left unchanged. Non-secret fields (text, host, email address) are not redacted. Secret values are scrubbed from error text as well before it reaches the client.
- Automated verification on a fake transport: connection abort, oversized response, redirect to a foreign host, secret returned in the body. No admin UI change, so no browser pass for screens.

When the product vision and this accepted approach differ, this approach wins for the duration of the change (no redirect at all, not only a foreign host).

## Non-goals

- Gmail connector (a later change will use the same egress client for connection checks then).
- Proxy kind.
- Call log.
- Admin UI changes.
- Edits to `mcp-gateway-spec.md` or files under `openspec/specs/` during apply (sync at archive).

## Capabilities

### New Capabilities

- `native-egress`: Gateway-built egress client for native tools — resolve allowlist from connector destinations and account host fields; HTTPS request and TLS connect only; refuse disallowed destinations before I/O; never follow redirects; timeout and max response size as code constants (injectable in tests); distinct short English network errors without headers or bodies; fake transport for automated verification.

### Modified Capabilities

- `connector-contract`: Native tool handler receives the gateway-built egress client for that account as an additional argument; `checkConnection` signature stays unchanged in this change.
- `mcp-endpoint`: On `tools/call`, build the egress client for the authorized account and pass it to the handler; map egress network errors to their distinct short English phrases (not `Tool execution failed`); scrub non-empty secret account field values from tool result text content and from error text before the MCP client sees them; a thrown handler error remains a fixed English message with no exception text.

## Impact

- New server module for the egress client (allowlist resolution, HTTPS/TLS operations, redirect/timeout/size policy) with injectable transport and limits for tests.
- `server/src/connectors/contract.ts`: extend `NativeToolHandler` with the egress client argument.
- `server/src/mcp/call.ts` (and related helpers): construct the client per call; surface egress errors; scrub secrets from results and errors.
- Tests under `server/test/` with a fake connector, fake transport, and fixture secrets; no live provider; no `web/` or admin UI changes.
