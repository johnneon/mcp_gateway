# Proposal

Issue: #15

## Why

Accounts, configurations with bearers, and the native connector contract already exist, but MCP still returns an empty `tools/list` after auth. Without native tool registration and per-configuration dispatch, a model cannot see or call connector tools through the accounts it is allowed to use, and secrets must never appear in tool arguments or schemas.

## What Changes

- Extend the native connector module with tools: short name, English description, JSON Schema for arguments, and a handler. The MCP tool name is `<connector id>_<tool name>`. Registry build fails if a tool's own schema already declares a property named `account`. Production registry stays empty; tests inject a fake native connector into the MCP app the same way they already inject a registry into the admin app.
- After the existing bearer check, the gateway still scans every configuration and uses the first enabled hash match. `tools/list` is built per request from that configuration: a connector's tools appear only when the configuration has at least one enabled account of that connector. No eligible account anywhere means an empty tools list. Existing empty `tools/list` behavior for an empty production registry stays.
- The gateway adds a required `account` argument to every tool. `enum` lists only the ids of enabled accounts of that connector included in the configuration. Labels appear in the property `description`, one per account, formatted `<id> (<label>)`. Do not use oneOf/const/title. Account field values are not in the schema.
- `tools/call` validates arguments against the tool JSON Schema plus the injected `account` property (Ajv, new server dependency). Then the gateway checks that `account` is in the configuration, enabled, and belongs to that connector; otherwise it returns a short English MCP error and does not call the handler.
- The handler receives the model arguments with `account` removed, plus the decrypted account field values. A thrown handler error is not forwarded; the client gets a fixed English message with no exception text.
- Automated verification on a fake connector only: two configurations (with and without the account); success increments a fake call counter and the handler sees decrypted field values; refusal cases leave the counter at zero.

When the product vision and this accepted approach differ, this approach wins for the duration of the change (account labels via property `description` + enum ids; Ajv validation; fake injected into MCP app).

## Non-goals

- Gmail connector.
- Proxy kind (still rejected at registry build; no child process).
- Network client restricted to allowed hosts.
- Stripping secrets out of a successful tool result.
- Call log.
- Admin UI changes.
- Edits to `mcp-gateway-spec.md` or files under `openspec/specs/` during apply (sync at archive).

## Capabilities

### New Capabilities

- (none)

### Modified Capabilities

- `connector-contract`: Native modules declare tools (short name, English description, JSON Schema, handler); MCP name is `<connector id>_<tool name>`; registry build fails when a tool schema already declares `account`; production registry remains empty; tests may inject a fake with tools into the MCP app factory.
- `mcp-endpoint`: After bearer auth, resolve the first enabled matching configuration; build `tools/list` per request from that configuration's eligible accounts; inject required `account` (enum + description labels); validate and authorize `tools/call` before the handler; strip `account` and pass decrypted field values to the handler; map handler throws to a fixed English MCP error. Existing bearer and empty-list scenarios for an empty production registry stay intact.

## Impact

- `server/src/connectors/contract.ts` and `registry.ts`: tool shape and build-time validation.
- `server/src/http/createMcpApp.ts` and MCP helpers: injectable connector registry; per-request tools/list and tools/call dispatch; resolve configuration after auth.
- `server/src/main.ts`: pass production empty registry into `createMcpApp` (alongside the store).
- New server dependency: Ajv (JSON Schema validation for tool arguments).
- Tests under `server/test/` with a fake native connector and two configurations; no live provider; no web/ or admin UI changes.
