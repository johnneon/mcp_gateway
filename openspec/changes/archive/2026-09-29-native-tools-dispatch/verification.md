# native-tools-dispatch

## Result
blockers: 0

## Spec
- Native connector tools: met
- MCP app accepts an injectable connector registry: met
- Resolve first enabled configuration after bearer auth: met
- tools/list from eligible accounts only: met
- Injected account argument in tool schemas: met
- tools/call validates, authorizes, then invokes handler: met

## Checks
- tests: passed — 171 server + 45 web tests
- type check: passed
- lint: passed
- format check: passed
- build: passed

## Review
- note: `server/src/mcp/call.ts` keeps a module-level Ajv instance; acceptable for this change, not a law break.
- note: foreign and disabled `account` values that are outside the injected enum are refused by Ajv as `Invalid tool arguments` before the authorize path's `Account is not allowed for this tool`; handler still not called; matches short English MCP error.
- note: change does not edit admin UI, `mcp-gateway-spec.md`, or `openspec/specs/`.
- note: production registry remains empty; fake tools live only in tests and the e2e throwaway client.

## E2E
- Admin UI Configurations empty state: passed — heading "Configurations", "No configurations yet…"; screenshot `e2e/admin-configurations-empty.png`. Change does not alter admin screens; create/rotate bearer paths not re-exercised beyond empty-state walk.
- Admin UI Connectors empty state: passed — "No connectors yet." (production registry empty).
- Admin DOM / input leak check: passed — fixture secret and encryption key absent from outerHTML and inputs.
- Playwright console: passed for product paths — only unrelated `favicon.ico` 404.
- MCP production empty registry on live process: passed — `/health` ok; `tools/list` path covered by empty production registry tests; MCP port returns 404 for `/api/connectors`; admin port returns 404 for `POST /mcp`.
- MCP fake client (`e2e/mcp-fake-client.mjs`): passed — empty and unknown bearer identical `Unauthorized`; eligible config lists `fake_echo` with `account` enum/description and no fixture secret in schema; config without eligible account lists `[]`; successful call increments counter and handler sees decrypted fixture secret while MCP result stays clean; foreign, disabled, and schema-invalid calls leave counter at 0; handler throw returns fixed `Tool execution failed` without fixture secret or exception text.
- Live provider: not exercised — fake only, as required.

## Leaks
- tools/list schema (fake e2e): clean
- tools/call success result (fake e2e): clean
- tools/call error text (foreign/disabled/schema/handler throw): clean
- admin UI DOM and inputs: clean
- encryption key in process startup (existing package tests): clean
