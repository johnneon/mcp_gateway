# Tasks

## 1. Egress client core

- [x] 1.1 Add the egress client module: resolve allowlist from constant and field-backed destinations (case-insensitive host match); typed/short errors `Destination is not allowed`, `Redirect is not allowed`, `Connection failed`, `Response too large`; production defaults timeout 30s and max body 67108864 bytes; injectable transport and smaller limits for tests. Unit tests with a fake transport: disallowed host:port leaves call count at 0; allowed destination with different hostname casing invokes transport once; HTTPS request and TLS connect each invoke the fake once without a URL argument. Check: those unit tests pass; `npm run typecheck -w server` exits 0.

- [ ] 1.2 Implement redirect refusal, abort/timeout, and oversized-body handling on the fake transport path: `redirect: manual`, any 3xx → `Redirect is not allowed` (one call only; no Location or body in the error); abort → `Connection failed`; body over injected max size → abort read, no truncated body returned, `Response too large`. Check: redirect-to-foreign, redirect-to-same-host, abort, and oversized scenarios pass; errors contain no headers or body bytes.

## 2. Handler signature and call dispatch

- [ ] 2.1 Extend `NativeToolHandler` to accept the egress client as the third argument; keep `checkConnection` without the client. Update existing fake handlers in server tests to the new signature. Unit/integration: handler records a present egress client on successful `tools/call`; `checkConnection` still invoked with account values only. Check: connector-contract scenario "Handler receives egress client; checkConnection does not" and existing registry build scenarios still pass.

- [ ] 2.2 In `dispatchToolCall`, build the egress client for the authorized account and pass it to the handler. Map egress network errors to their exact short English phrases for the MCP client (not `Tool execution failed`); keep other handler throws as the fixed `Tool execution failed` without exception text. Check: successful call still increments the fake counter and passes decrypted values; egress `Destination is not allowed` reaches the MCP client unchanged; handler-throw scenario still returns the fixed English error without the secret.

## 3. Secret scrubbing

- [ ] 3.1 Before returning a tool result or MCP error to the client, replace every non-empty account secret field value with `[redacted]` in each text content part and in error text; replace longer secrets first; leave empty secrets and non-secret fields (`text`, `host`) unchanged. Tests: secret in body is redacted; longer-before-shorter; empty secret and non-secret fields untouched; secret embedded in error text is scrubbed. Check: those mcp-endpoint scrubbing scenarios pass.

## 4. Full package check

- [ ] 4.1 From the repository root: `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build` exit 0. Test names cover every new scenario in the `native-egress`, `connector-contract`, and `mcp-endpoint` deltas; existing bearer, empty-list, and tools/call refusal scenarios still pass. Check: every command exits 0.
