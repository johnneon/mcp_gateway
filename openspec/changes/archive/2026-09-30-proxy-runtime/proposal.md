# Proposal

Issue: #20

## Why

The gateway can register native connectors, but it still has no way to run a third-party MCP server as a child process. Vision section «Вид proxy» and issue 20 ask for that runtime first: one stdio process per account, started from an already installed pinned package, with an environment that does not inherit the gateway. Tool allowlisting and a real proxy connector come later.

## What Changes

- Add a proxy runtime the tests call directly with a descriptor. It speaks MCP over stdio to a child process. The production connector registry still rejects `kind` `proxy`. No product proxy connector is registered. Gmail and the MCP port tool list do not change.
- Pin a fake stdio MCP server at `packages/fake-stdio-mcp` with an exact package version. `server` depends on it with a `file:` dependency and no version range. The package is installed before spawn. Spawn uses `process.execPath` and the path to that already installed file. Nothing is downloaded at spawn, and `npx` is not used.
- One child process per account. The process starts on the first call for that account, stops after an idle timeout, and starts again on the next call after a crash or after the idle stop. The idle timeout is a 5 minute constant in code. Tests inject the clock and the timeout. Tests do not sleep.
- The child environment is built from scratch: only variables the descriptor maps from account fields, plus `PATH` on every OS, plus `SYSTEMROOT` on Windows. `TEMP`, `TMP`, `PATHEXT`, `HOME`, `USERPROFILE`, and the rest of the gateway environment are not copied. `ENCRYPTION_KEY` does not reach the child.
- The fake counts launches and reports the environment it received. Tests assert launch count, restart, idle stop, and that environment.

When the product vision and this accepted approach differ, this approach wins for the duration of the change (runtime only; registry still rejects `proxy`; no product proxy connector; minimum environment is `PATH` and, on Windows, `SYSTEMROOT`).

## Non-goals

- Tool allowlist.
- Stripping the `account` parameter before the child.
- Scrubbing secrets from stdout or stderr.
- Hiding stderr from the client.
- URL or host checks on tool arguments.
- A live third-party connector.
- Exposing proxy tools on the MCP port.
- Admin UI.
- Edits to `mcp-gateway-spec.md` or files under `openspec/specs/` during apply (sync at archive).

## Capabilities

### New Capabilities

- `proxy-runtime`: Stdio child MCP process per account — pinned installed package, spawn without download, idle stop and restart, child environment built from mapped account variables plus the launch minimum, verified with a fake that counts launches and reports its environment. Production registry continues to reject `kind` `proxy`.

### Modified Capabilities

- (none)

## Impact

- New workspace package `packages/fake-stdio-mcp` (exact version) and a `file:` dependency from `server` with no version range. Root workspaces include that package so install links it.
- New server module under `server/src/connectors/proxy/` (session per account, env builder, spawn, idle clock). `main.ts` does not read the gateway environment into the child. The production registry in `server/src/connectors/registry.ts` stays as it is, including the Gmail connector and the `proxy` rejection.
- Tests under `server/test/` call the runtime with a descriptor that points at the installed fake. No live provider. No web or admin UI changes. Existing Gmail and MCP tool-list tests stay green without new proxy tools on the MCP port.
