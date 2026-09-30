# Tasks

## 1. Fake stdio package

- [x] 1.1 Add `packages/fake-stdio-mcp` (`@mcp-gateway/fake-stdio-mcp`, version exactly `1.0.0`, plain ESM `index.js`) that increments a launch-count file from `argv[2]`, serves MCP over stdio, and implements `report_env` (JSON `env`, `execPath`, `argv`, `pid`) and `crash` (`process.exit(1)`). Add the workspace, the server `file:../packages/fake-stdio-mcp` dependency with no version range, the ESLint ignore, and the Prettier globs from `design.md`. Install so the package resolves. Test name covers requirement `Pinned package and spawn without download` and scenario `Server depends on the exact installed package`. Check: that test passes.

## 2. Spawn and child environment

- [x] 2.1 Add `server/src/connectors/proxy/` with `buildChildEnv` and `createProxyRuntime` that spawn `process.execPath` plus the installed entry, pass a complete `env` (no `process.env` spread, no SDK transport that merges the parent environment), and do not read `process.env` or `process.platform`. Tests call the runtime with a descriptor resolved from the installed package. Cover scenarios `Child starts from the installed file`, `Missing entry file does not spawn`, `First call starts one process`, `Non-Windows child receives PATH and mapped variables only`, and `Windows child also receives SYSTEMROOT`. Check: those tests pass; `npm run typecheck -w server` exits 0.

## 3. One process per account

- [ ] 3.1 Reuse a live child for the same account, keep a separate child per account id, and share one in-flight start when two calls overlap. Cover scenarios `Second call reuses the running child`, `Two accounts get two processes`, and `Overlapping calls share one process`. Check: those tests pass.

## 4. Idle stop

- [ ] 4.1 Export `PROXY_IDLE_TIMEOUT_MS` as `300000`. Accept an injected clock, `schedule`, and timeout. Stop the child only when that account has no call in flight. Cover scenarios `Production idle timeout is 5 minutes` and `Injected clock stops the child and the next call starts a new one`. The idle test must not sleep. Check: those tests pass.

## 5. Restart after exit

- [ ] 5.1 When the child exits, fail the in-flight call with fixed English text that does not include mapped account values, and start a new child only on the next call. Cover scenarios `Next call after exit starts a new process` and `In-flight call fails without the account secret`. Check: those tests pass.

## 6. Registry stays unchanged

- [ ] 6.1 Do not change registry build or the production connector list. Cover scenarios `Proxy kind fails registry build and starts no child` and `Production registry includes Gmail and no proxy connector`. Existing Gmail and MCP tool-list tests stay as they are. Check: those new scenarios pass; existing `server` registry, Gmail, and mcp-endpoint tests pass.

## 7. Full package check

- [ ] 7.1 From the repository root, `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`, and `npm run build` exit 0. Every scenario in `specs/proxy-runtime/spec.md` has a test whose name includes the requirement and the scenario. Check: every command exits 0.
