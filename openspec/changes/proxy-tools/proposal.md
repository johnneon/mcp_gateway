# Proposal

Issue: #21

## Why

The proxy runtime can already run one stdio child per account, but the registry still rejects every `kind: proxy` module, so an MCP client cannot see or call any of that child's tools. Vision section «Вид proxy» and issue 21 ask for the next slice: only an allowlist declared in connector code is exposed, with the same public name and `account` parameter as native tools.

## What Changes

- **BREAKING** for registry build: a module with `kind: proxy` becomes registrable when it keeps the shared module shape (`fields`, `allowedDestinations`, `checkConnection`) and declares a tool allowlist. Each allowlisted tool has a short name, an English description, and a JSON Schema of arguments. It has no handler, and its schema has no `account` property. Registry build still does not start a child process. This replaces the hard rejection of every `kind: proxy` module in `connector-contract` and in `proxy-runtime` («Production registry still rejects proxy»).
- The production registry still contains only Gmail and no proxy connector. Tests inject their own registry into the MCP app. The fake proxy connector's `checkConnection` does not spawn a child.
- A proxy module also declares how to build the existing runtime descriptor: the absolute entry path of an already installed package, extra child arguments, and which account fields map to which child environment variables. Model arguments do not carry that path, those arguments, or a secret. Idle timeout, env construction, and one process per account stay as `proxy-runtime` defined them.
- `tools/list` is built from that in-code allowlist on the same path as native tools: public name `<connector id>_<short name>`, and a required `account` parameter whose enum and description list only eligible account ids and labels. `tools/list` does not start the child. The child still starts on the first `tools/call`. A tool the fake serves but that is not on the allowlist does not appear.
- `tools/call` checks `account`, strips it, and calls the child by the short name through `server/src/connectors/proxy/runtime.ts`. The argument schema is the connector allowlist, not the child's `tools/list`.
- Result text is scrubbed with the existing secret scrub (`server/src/mcp/scrub.ts`). stderr stays discarded in `ChildPipeTransport` (`child.stderr?.resume()`) and is not copied into the MCP response.
- Extend `packages/fake-stdio-mcp` (still exact version `1.0.0`, no `npx`) with a tool that returns the arguments it received, and a tool that returns the account secret from the mapped env var and writes a non-secret marker to stderr. Keep `report_env` and `crash`. The test connector allowlist includes only the echo-args tool and the leak tool.

When the product vision and this accepted approach differ, this approach wins for the duration of the change (a proxy module with a valid allowlist is registrable; URL and host checks on tool arguments are not this change; stderr is discarded and not returned, and the result text is scrubbed).

## Non-goals

- No product proxy connector in the production registry.
- Do not check that allowed tools reject URL or host arguments. The vision says that check belongs to the change that adds a real connector.
- No remote HTTP MCP transport.
- Do not change idle timeout, env construction, or one-process-per-account behavior from proxy-runtime except as needed to forward an allowlisted call.
- Do not edit `mcp-gateway-spec.md` or `openspec/specs/` during apply (deltas only; sync at archive).

## Capabilities

### New Capabilities

- (none)

### Modified Capabilities

- `connector-contract`: A `kind: proxy` module with the shared shape and a valid tool allowlist (no handler, no `account` property) is registrable. Registry build does not start a child. Native tools still require a handler. The production registry stays Gmail-only.
- `proxy-runtime`: Replace «Production registry still rejects proxy». A valid proxy module registers without starting a child. The production registry still has Gmail and no proxy connector. The fake stdio server gains the echo-args and leak tools at version `1.0.0`. Idle timeout, env construction, and one process per account stay.
- `mcp-endpoint`: `tools/list` and `tools/call` for an injected proxy allowlist use the native prefix and `account` path. The child starts on call, not on list. The call uses the short name and arguments with `account` removed. Result text is scrubbed. stderr is not in the client response.

## Impact

- `server/src/connectors/contract.ts` and `registry.ts`: proxy allowlist shape and build-time validation. `kind: proxy` is no longer an automatic registry failure.
- `server/src/mcp/call.ts` and `tools.ts`: list and call an allowlisted proxy tool through the existing proxy runtime; scrub the text result. `tools/list` does not call the runtime.
- `server/src/http/createMcpApp.ts` and `server/src/main.ts`: the MCP app can forward an allowlisted call. `main.ts` supplies the parent environment the runtime already expects. No new product connector in the production registry.
- `packages/fake-stdio-mcp` (version stays `1.0.0`): echo-args and leak tools, plus the existing `report_env` and `crash`.
- Tests under `server/test/` inject a fake proxy connector. They replace the assertions that every `kind: proxy` module fails registry build. No live provider. No admin UI change.
