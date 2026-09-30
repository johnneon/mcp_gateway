# Design

## Context

See `proposal.md` — Why. Native connectors, the Gmail connector, and MCP tool dispatch already exist. `buildConnectorRegistry` rejects `kind` `proxy` and does not start a child (`server/src/connectors/registry.ts`). There is no `server/src/connectors/proxy/` module. The backend layout reserves that folder for stdio child processes. Only `main.ts` may read `process.env`. Vision for the full proxy kind is `mcp-gateway-spec.md` section «Вид proxy»; issue 20 is the runtime slice. Accepted decisions below are not reopened.

## Goals / Non-Goals

**Goals:**

- A runtime tests call with a descriptor: one stdio MCP child per account id, spawned from an installed file, idle-stopped, and restarted on the next call.
- A pure env builder whose inputs are a platform, a parent environment object, and mapped variables. It does not read `process.env`.
- A fake stdio MCP server package the child runs, which counts launches and reports the environment, executable, arguments, and pid it received.

**Non-Goals:**

- Tool allowlist, stripping `account`, scrubbing stdout or stderr, hiding stderr from an MCP client, URL or host argument checks, a live third-party connector, proxy tools on the MCP port, admin UI.
- Registering a proxy connector. The production registry and Gmail stay as they are.
- Edits to `mcp-gateway-spec.md` or `openspec/specs/` during apply.

## Decisions

Accepted by the person before propose. No open questions remain for this change.

### 1. Package and spawn

- New workspace `packages/fake-stdio-mcp`, package name `@mcp-gateway/fake-stdio-mcp`, `"version": "1.0.0"`, `"type": "module"`, entry `index.js` (plain ESM). Node runs it with `process.execPath` and no loader.
- Root `workspaces` gains `packages/fake-stdio-mcp`. `server/package.json` depends on `"@mcp-gateway/fake-stdio-mcp": "file:../packages/fake-stdio-mcp"` with no semver range.
- Tests resolve the installed entry with the package name (`createRequire` / `import.meta.resolve`), and pass that absolute path on the descriptor. The runtime checks the file exists, then `spawn(process.execPath, [entryPath, ...descriptor.args], { env, stdio: ['pipe', 'pipe', 'pipe'], shell: false, windowsHide: true })`. The `env` option is the complete child environment. Do not spread `process.env`.
- Do not use the SDK `StdioClientTransport` if it merges the parent environment into `env`. Own the spawn. Use `@modelcontextprotocol/sdk` `Client` on those pipes.
- Missing entry: fail with a fixed English message before spawn. Launch count stays 0.

**Alternative (rejected):** `npx` or a version range — rejected; the package is already installed and the dependency is `file:`.
**Alternative (rejected):** TypeScript entry plus a type-stripping flag — rejected; the installed file is plain JavaScript so spawn needs no extra node flags.

### 2. Descriptor and call

```text
descriptor: { accountId, entryPath, args, variables }
call(descriptor, toolName, arguments) -> { text }
```

- `variables` is the name-to-value map the caller already built from account fields. The runtime does not look up accounts or the store.
- The runtime does not add or remove an `account` argument and does not filter tool names.
- Environment is fixed at spawn. A later call for the same account reuses the child even if `variables` differ. This change does not restart on a variable change.
- `close()` stops every child so tests do not leak processes. `main.ts` does not construct the runtime.

### 3. One session per account

- Key sessions by `accountId`.
- The first call spawns, performs MCP `initialize`, then `tools/call`.
- A second call while that child is alive sends `tools/call` on the same client.
- Overlapping calls for one account await a single in-flight start promise, so the launch count is 1.
- A different `accountId` has its own session and its own child.

**Alternative (rejected):** start the child at process boot — rejected; start on the first call.

### 4. Idle timeout

- Export `PROXY_IDLE_TIMEOUT_MS = 300000`.
- `createProxyRuntime` requires `idleTimeoutMs`, `now`, and `schedule(callback, delayMs) -> { cancel }`. It does not call `setTimeout` or `Date.now` itself.
- When a call finishes and that account has no other call in flight, cancel the previous timer and `schedule` the stop for `idleTimeoutMs`. Do not stop a child while a call is in flight.
- The stop callback kills that child and drops the session. The next call spawns again.
- Tests advance a fake clock and run due callbacks. They do not sleep.

**Alternative (rejected):** a real 5 minute sleep in tests — rejected; the clock and the timeout are injected.

### 5. Crash

- The fake tool `crash` exits the process with code 1 and does not write a tool result.
- On child `exit`, drop the session and reject the in-flight call with a fixed English message (`The proxy server stopped.`). Do not interpolate account values, stdout, or stderr. Do not spawn again until the next call.
- That next call starts a new process (launch count increases by one).

**Alternative (rejected):** retry the failed call inside the runtime — rejected; restart happens on the next call.

### 6. Child environment

`buildChildEnv({ platform, parentEnv, variables })` starts from an empty object.

- Copy `PATH` when the parent has a variable whose name equals `PATH` case-insensitively. Set the child key to `PATH`.
- When `platform` is `win32`, also copy the parent variable whose name equals `SYSTEMROOT` case-insensitively, and set the child key to `SYSTEMROOT`. Otherwise do not set `SYSTEMROOT`.
- Then set `variables`. A mapped name overrides `PATH` or `SYSTEMROOT` only when the descriptor uses that name.
- Copy nothing else. In particular do not copy `TEMP`, `TMP`, `PATHEXT`, `HOME`, `USERPROFILE`, `ENCRYPTION_KEY`, `MCP_HOST`, `MCP_PORT`, `ADMIN_HOST`, `ADMIN_PORT`, `DATA_DIR`, or `NODE_OPTIONS`.
- Tests pass `parentEnv` and `platform`. The runtime does not read `process.env` or `process.platform`.

**Alternative (rejected):** `child_process` default inheritance — rejected; that would pass `ENCRYPTION_KEY`.
**Alternative (rejected):** also copy `TEMP`, `TMP`, `PATHEXT`, `HOME`, or `USERPROFILE` — rejected; the accepted minimum is `PATH` plus `SYSTEMROOT` on Windows.

### 7. Fake stdio MCP server

- Speaks newline-delimited JSON-RPC on stdio: `initialize` (echo the client's protocol version), `notifications/initialized`, `tools/list`, `tools/call`.
- On startup, if `process.argv[2]` is a path, increment an integer stored in that file (create it at 0). That path is a descriptor argument the test passes. It is not an environment variable.
- Tool `report_env`: text content is JSON `{ env, execPath, argv, pid }` where `env` is `process.env`.
- Tool `crash`: `process.exit(1)`.
- No network calls.
- Stderr is not a product feature here. The runtime pipes stderr and drains it so the child cannot block, and does not put those bytes in the call result or the error. It does not scrub them.

### 8. Registry and MCP port

- Do not change `buildConnectorRegistry` or the production array (Gmail stays, `proxy` still throws).
- Do not change `server/src/mcp/` or the admin UI.
- New tests cover the delta scenarios, including registry build of a `proxy` module with launch count still 0, and `productionConnectorRegistry.listPublic()` containing `gmail` and no `kind` `proxy`.
- Existing Gmail and MCP tool-list tests stay as they are.

### 9. Lint and format

- The fake is plain JavaScript outside the server TypeScript project. Ignore `packages/fake-stdio-mcp/**` in `eslint.config.js` so type-checked lint does not parse it.
- Include `packages/**/*.{js,json}` in the root `format` and `format:check` scripts.

## Risks / Trade-offs

- [SDK stdio helper merges `process.env`] → Mitigation: spawn in this module with a complete `env` object and do not use a transport that copies the parent environment.
- [Windows stores `Path` and `SystemRoot` with that casing] → Mitigation: case-insensitive lookup, canonical child keys `PATH` and `SYSTEMROOT`. Scenarios pass the canonical names.
- [Idle timer kills a child mid-call] → Mitigation: schedule the stop only when that account has no call in flight.
- [stderr contains a secret in a later connector] → Mitigation: this change drains stderr and does not return it; scrubbing is a later change.
- [Plain JS fake is outside `tsc`] → Mitigation: the fake is small and ignored by type-checked ESLint; the server runtime stays in `server/src` and is type-checked.

## Migration Plan

- No store document change. After merge, install so the new workspace package is linked before the process starts.
- Rollback: revert the pull request. No proxy connector is registered, so current MCP clients see the same tool list.

## Open Questions

None. The accepted decisions above close the pinned `file:` package, spawn via `process.execPath`, one process per account, the 5 minute idle constant with an injected clock, restart on the next call after exit or idle stop, the minimum environment (`PATH`, and `SYSTEMROOT` only on Windows), direct runtime calls with a descriptor, and an unchanged production registry.
