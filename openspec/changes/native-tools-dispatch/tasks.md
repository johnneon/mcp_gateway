# Tasks

## 1. Connector tools on the module and registry

- [ ] 1.1 Extend the native connector module type with `tools` (short `name` matching `^[a-z0-9_]+$`, English `description`, arguments JSON Schema, `handler`). Update `buildConnectorRegistry` to validate tools (unique names, reject a schema property named `account`) and expose MCP names as `<connector id>_<tool name>`. Keep the production registry empty. Unit tests with a fake: successful build exposes `<id>_echo`; schema with `account` fails build; production export length 0. Check: those registry tests pass; `npm run typecheck -w server` exits 0.

## 2. Inject registry into MCP app and resolve configuration

- [ ] 2.1 Extend `createMcpApp` options with a connector registry; `main.ts` passes the production empty registry. After successful bearer auth, resolve the first enabled hash-matching configuration (full scan preserved for accept/refuse). Existing bearer 401 scenarios and empty `tools/list` with the production empty registry still pass. Check: existing mcp-endpoint auth and empty-list tests pass; `npm run typecheck -w server` exits 0.

## 3. Per-request tools/list with injected account

- [ ] 3.1 Build `tools/list` per request from the active configuration and registry: list a connector's tools only when it has at least one eligible account; inject required `account` (`enum` of eligible ids; `description` with one `<id> (<label>)` per account; no oneOf/const/title; no account field values in the schema). Tests: configuration with account lists the fake tool with correct enum/description; configuration without the account yields `[]`; empty production registry still yields `[]`; serialized schema has no secret field values. Check: those list scenarios pass.

## 4. tools/call validate, authorize, handler

- [ ] 4.1 Add Ajv as a server dependency. On `tools/call`, validate arguments against the tool schema plus injected `account`; authorize eligible account; call handler with `account` removed and decrypted field values; map handler throws to a fixed English MCP error without exception text or secrets. Tests with a fake call counter and two configurations: success increments counter and handler sees decrypted values including a fixture secret; refusal for account absent from configuration, foreign account, disabled account, and schema validation failure leave the counter at 0; handler throw returns fixed English error without the secret or exception message. Check: those call scenarios pass; `npm run typecheck -w server` exits 0.

## 5. Full package check

- [ ] 5.1 From the repository root: `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build` exit 0. Test names cover every new scenario in the `connector-contract` and `mcp-endpoint` deltas; existing bearer and empty-list scenarios still pass. Check: every command exits 0.
