# Design

## Context

See `proposal.md` — Why. Native tools already list and call through `server/src/mcp/tools.ts` and `server/src/mcp/call.ts`, including the injected `account` argument and the `[redacted]` scrub in `server/src/mcp/scrub.ts`. `buildConnectorRegistry` still throws for every `kind: proxy` module and does not start a child (`server/src/connectors/registry.ts`). The proxy runtime in `server/src/connectors/proxy/runtime.ts` already speaks MCP over stdio: `call(descriptor, toolName, arguments)` with `descriptor` `{ accountId, entryPath, args, variables }`. `ChildPipeTransport` discards stderr with `child.stderr?.resume()` and does not put those bytes in the result. `main.ts` does not construct that runtime. The installed fake is `packages/fake-stdio-mcp` at version `1.0.0` with tools `report_env` and `crash`. Accepted decisions below are not reopened.

## Goals / Non-Goals

**Goals:**

- One registry path for native and proxy modules. Proxy tools are an allowlist: short name, English description, JSON Schema, no handler.
- Gateway `tools/list` and `tools/call` for that allowlist, using the existing prefix, `account` injection, and scrub. The child starts on the first successful call, not on list.
- The fake gains `echo_args` and `leak_secret` so tests can see the arguments the child received, a secret in the result, and a stderr marker the client does not see.

**Non-Goals:**

- See `proposal.md`. In particular: no product proxy connector, no URL or host check on tool arguments, no HTTP MCP transport, and no change to idle timeout, `buildChildEnv`, or one process per account except forwarding an allowlisted call.

## Decisions

Accepted by the person before propose. No open questions remain for this change.

### 1. One module shape, two tool kinds

`ConnectorModule` becomes a discriminated union on `kind`. Shared fields stay `id`, `name`, `fields`, `allowedDestinations`, and `checkConnection` (same signature: account values and the egress client). Native tools stay `{ name, description, inputSchema, handler }`.

A proxy module adds:

- `tools`: `{ name, description, inputSchema }` with no `handler`
- `entryPath`: non-empty string, the absolute path of an already installed file, written in connector code
- `args`: `readonly string[]`, forwarded as the runtime descriptor's extra arguments (empty is valid)
- `env`: `{ field, variable }[]`, account field name to child environment variable name

Registry build validates the shared shape first, then kind-specific tools. It does not stat `entryPath`, does not import `child_process`, and does not call the runtime. An empty proxy `tools` array is valid and exposes nothing. A proxy tool whose schema has an `account` property fails. A proxy tool that has a `handler` function fails. An `env` entry whose `field` is not on the module fails. A native tool still requires a handler.

The production array stays the Gmail connector only.

**Alternative (rejected):** keep rejecting every proxy module and hang the allowlist off a side table — rejected; registration stays one path.
**Alternative (rejected):** give proxy tools a handler that closes over the runtime — rejected; the accepted allowlist has no handler, and the gateway performs the call.

### 2. Registry tools

A built proxy tool is stored like a native tool (MCP name `<id>_<short name>`, description, allowlist schema) with `kind: 'proxy'` and no handler. `listToolsForConfiguration` does not look at `kind` and does not take a runtime. It already adds `account` from eligible accounts. That is the list path for proxy tools too.

### 3. Call path

`dispatchToolCall` keeps validation and the eligible-account check. The schema is `buildToolInputSchema` of the allowlist schema, never the child's `tools/list`.

For `kind: 'proxy'`, after that check succeeds, strip `account`, build `variables` only from the module's `env` bindings and the selected account's field values, and `runtime.call` with the short name. Do not pass the public prefixed name. Do not build an egress request for the tool call. Wrap `{ text }` as one text content part and pass it through `scrubSecretsInToolResult`.

If validation or the account check fails, do not call the runtime (launch count stays 0). Runtime and child failures use the existing fixed English MCP error path. Do not interpolate stderr, stdout, or account values into a new error string.

`createMcpApp` accepts an optional `proxyRuntime`. `main.ts` constructs one with `PROXY_IDLE_TIMEOUT_MS`, `process.platform`, a parent environment object taken from `process.env` in `main.ts` only, `Date.now`, and `setTimeout`. The runtime still does not read `process.env` or `process.platform`. Tests that call a proxy tool pass a runtime and `close()` it. A proxy call with no runtime returns the existing fixed English tool-failure message and does not spawn.

`tools/list` does not receive the runtime.

**Alternative (rejected):** call the child's `tools/list` and filter — rejected; list would start the child, and the schema would come from the child.
**Alternative (rejected):** a second MCP app factory for proxy — rejected; tests already inject a registry into `createMcpApp`.

### 4. stderr

Do not change `ChildPipeTransport` except to keep stderr discarded. Do not read `stderr` into the tool result or the MCP error. The leak tool writes `fake-stdio-mcp-stderr-marker` to stderr; the client-visible text must not contain it. Secret scrub stays in `server/src/mcp/scrub.ts` on the result text only.

**Alternative (rejected):** scrub stderr and return it — rejected; the accepted approach discards stderr and does not return it.

### 5. Fake stdio server

Stay on `@mcp-gateway/fake-stdio-mcp` version `1.0.0` and the `file:` dependency. No `npx`.

Add tools to the child's own `tools/list` (the gateway does not use that list):

- `echo_args` — text is `JSON.stringify` of the arguments object on `tools/call`. The child's schema does not require properties, so a gateway rejection for a missing `note` is the allowlist schema, not the child.
- `leak_secret` — `process.stderr.write` of `fake-stdio-mcp-stderr-marker` plus a newline, then text containing `process.env.TOKEN` (empty string when unset).

Keep `report_env` and `crash`.

The test connector allowlist is only `echo_args` (schema requires string `note`) and `leak_secret` (no author-required properties). It maps the account secret field to the variable `TOKEN`. `entryPath` is the installed package entry. `args` is the launch-count file path the fake already reads from `argv[2]`. `checkConnection` returns without touching that file and without spawning.

**Alternative (rejected):** bump the fake to `1.0.1` — rejected; the package version stays exactly `1.0.0`.

## Risks / Trade-offs

- [Existing tests expect every proxy module to throw] → Mitigation: replace those assertions with the new scenarios. Keep the check that `registry.ts` does not import `child_process` or call `spawn`.
- [`main.ts` passes `process.env` as `parentEnv`] → Mitigation: `buildChildEnv` is unchanged and still copies only `PATH` and, on Windows, `SYSTEMROOT`, then the mapped variables. The runtime still does not read `process.env`.
- [SDK client might surface stderr later] → Mitigation: leave `stderr.resume()` and assert the marker is absent from the MCP result.
- [A proxy tool result contains the secret before scrub] → Mitigation: scrub the text after the runtime returns, with the existing longer-first replacement.
- [Child `tools/list` includes `report_env` and `crash`] → Mitigation: the gateway lists only the registry allowlist.

## Migration Plan

- No store document change. No new product connector. After merge, MCP clients of the production registry still see only Gmail tools.
- Rollback: revert the pull request. A proxy module stops being registrable again, and the fake's extra tools are unused because no connector allowlists them.

## Open Questions

None. The accepted decisions above close the allowlist shape, registration without a child, list versus call, the short name with `account` removed, result scrub, discarded stderr, and the fake's `echo_args` and `leak_secret` tools at version `1.0.0`.
