# Tasks

## 1. Proxy allowlist in the registry

- [x] 1.1 Change `ConnectorModule` into a `kind` union per `design.md`. A proxy module keeps `fields`, `allowedDestinations`, and `checkConnection`, and adds an allowlist without handlers plus `entryPath`, `args`, and `env`. `buildConnectorRegistry` accepts a valid proxy module and still does not import `child_process` or start a child. The production registry stays Gmail only. Replace the tests that expect every `kind: proxy` module to throw: keep the assertion that `server/src/connectors/registry.ts` does not reference `child_process`, `spawn`, or `fork`. Cover connector-contract scenarios `Empty proxy allowlist registers and starts no child`, `Proxy tool schema that declares account fails registry build`, `Proxy tool with a handler fails registry build`, `Env binding must name a field on the connector`, `Fake proxy checkConnection does not spawn`, and `Valid proxy allowlist registers and starts no child`. Retitle the production-list test to proxy-runtime requirement `Production registry has no proxy connector` and scenario `Production registry includes Gmail and no proxy connector` without weakening the Gmail and no-proxy assertions. Retitle the duplicate-id and bad-id tests to requirement `Registry build validates modules`; their assertions stay. Existing scenarios `Fake native connector satisfies the contract` and `Connection check is callable without HTTP exposure` stay as they are. Check: those tests pass.

## 2. Fake echo and leak tools

- [ ] 2.1 Extend `packages/fake-stdio-mcp` in place at version exactly `1.0.0` with `echo_args` and `leak_secret` per `design.md`. Keep `report_env` and `crash`. Do not use `npx`. Cover proxy-runtime scenarios `echo_args returns the arguments it received` and `leak_secret returns TOKEN and writes the stderr marker` by driving the installed fake and capturing stderr in the test, not through `ChildPipeTransport`. Check: those tests pass, and the existing scenario `Server depends on the exact installed package` still passes.

## 3. tools/list from the allowlist

- [ ] 3.1 List proxy tools through the existing `listToolsForConfiguration` path (prefix and injected `account`). `tools/list` must not take or call the proxy runtime. The test connector allowlist is only `echo_args` and `leak_secret`. Cover mcp-endpoint scenarios `Allowlisted tools are listed with prefix and account and list starts no child`, `Tools off the allowlist do not appear`, and `No eligible account hides proxy tools`. Check: those tests pass.

## 4. tools/call, scrub, and stderr

- [ ] 4.1 On a successful allowlisted call, `dispatchToolCall` checks `account`, strips it, and calls `createProxyRuntime` with the short name and the connector descriptor (`entryPath`, `args`, env bindings only). Schema stays the allowlist schema. Scrub the text with `scrubSecretsInToolResult`. Do not copy stderr into the response, and do not change idle timeout, `buildChildEnv`, or one-process-per-account behavior. `main.ts` constructs the runtime and passes `parentEnv` from `process.env`; the runtime still does not read `process.env`. Tests inject the runtime and close it. Cover mcp-endpoint scenarios `echo_args receives arguments without account`, `Allowlist schema rejects a call the child would accept`, `Ineligible account does not start the child`, `Non-allowlisted tool name does not start the child`, and `Secret in the result is redacted and the stderr marker is absent`. Check: those tests pass.

## 5. Full package check

- [ ] 5.1 From the repository root, `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`, and `npm run build` exit 0. Do not introduce explicit `any`. Every new or replaced scenario in this change's delta specs has a test whose name includes the requirement and the scenario. Do not edit `mcp-gateway-spec.md` or files under `openspec/specs/`. Check: every command exits 0.
