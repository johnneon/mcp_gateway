# Design

## Context

See `proposal.md` — Why. Today `createMcpApp({ store })` authenticates the bearer, then serves a stateless Streamable HTTP `McpServer` with no tools (`tools/list` is `[]`). The native connector contract (`id`, `name`, `kind`, `fields`, `allowedDestinations`, `checkConnection`) and an empty production registry already exist; tests inject a registry into `createAdminApp`. Accounts and configurations with `accountIds` are on the encrypted store. Vision: `mcp-gateway-spec.md` (call flow, Tools, native kind). This change closes the issue line «Решить в дизайне» (how account labels appear in the `account` schema). Accepted decisions below are not reopened.

## Goals / Non-Goals

**Goals:**

- Native modules declare tools; MCP names are `<connector id>_<tool name>`; registry rejects a tool schema that already declares `account`.
- Per-request `tools/list` and `tools/call` scoped to the first enabled configuration that matches the bearer, using only enabled accounts included in that configuration.
- Inject required `account` (enum ids + labels in property `description`); validate with Ajv; refuse foreign/disabled/absent account before the handler; strip `account` and pass decrypted field values to the handler.
- Fake connector is test-only, injected into the MCP app; production registry stays empty.

**Non-Goals:**

- Gmail connector, proxy kind, network client host restriction, secret stripping from tool results, call log, admin UI.
- Edits to `mcp-gateway-spec.md` or `openspec/specs/` during apply.

## Decisions

Accepted by the person before propose; they are not reopened here. No open questions remain for this change.

### 1. Native connector tools on the module

- Extend `ConnectorModule` with `tools`: each tool has a short `name` (string matching `^[a-z0-9_]+$`, unique within the connector), English `description`, JSON Schema object for arguments (`type: object` with `properties` / `required` as needed), and a `handler`.
- MCP tool name is always `<connector.id>_<tool.name>` (e.g. `fake_echo`).
- Registry build fails if any tool's own argument schema already declares a property named `account` (gateway owns that name).
- Production registry remains `buildConnectorRegistry([])`. No product connector ships in this change.

**Alternative (rejected):** separate tools registry beside connectors — rejected; tools belong on the connector module per vision.

### 2. Inject registry into `createMcpApp` (same pattern as admin)

- Extend `CreateMcpAppOptions` with a connector registry (required or defaulting to the production empty export).
- `main.ts` passes the production empty registry.
- Tests build a registry with a fake native connector that has tools and pass it into `createMcpApp`, mirroring how admin tests pass a registry into `createAdminApp`.
- The fake is test-only; it is not imported by the production registry module.

**Alternative (rejected):** import a test fake from production code — rejected; production stays empty.

### 3. Resolve configuration after bearer check: first enabled hash match

- Keep the existing full-scan bearer check semantics for accept/refuse (identical 401 cases unchanged).
- After acceptance, resolve the configuration used for tools: scan every configuration in store order; the **first** row whose hash matches and `enabled` is true is the active configuration for this request.
- Re-read the store on every request (already true for auth).

**Alternative (rejected):** pick an arbitrary enabled match when several share a token — rejected; person locked first enabled hash match. (Issued tokens are unique per configuration in practice.)

### 4. Per-request `tools/list` from eligible accounts

- Build the tool list for the active configuration only.
- Eligible account for a connector: id is in the configuration's `accountIds`, account exists, `enabled` is true, and `connector` equals that connector's id.
- If a connector has at least one eligible account, register/list all of that connector's tools (with injected `account`). If none, omit that connector's tools entirely.
- If no connector has any eligible account (or the registry is empty), `tools/list` is `[]` — same observable empty list as today for the empty production registry.
- Existing mcp-endpoint bearer scenarios and the empty-list scenario for an empty registry stay intact.

**Alternative (rejected):** always list all registry tools and fail only on call — rejected; vision hides connectors without accessible accounts.

### 5. Injected `account` argument: enum + description labels (closes «Решить в дизайне»)

- Gateway merges a required property `account` into every tool's input schema for MCP.
- `type`: `string`.
- `enum`: only the ids of eligible accounts for that tool's connector.
- `description`: lists those accounts so clients can show labels — **one entry per account**, each formatted `<id> (<label>)`. Do **not** use `oneOf` / `const` / `title` for labels.
- Account field values (including secrets) SHALL NOT appear in the tool schema or in model-facing argument definitions.
- Tool authors MUST NOT declare `account` themselves (registry build fails if they do).

**Alternative (rejected):** `oneOf` with `const` + `title` per account — rejected; person locked enum + description formatting.

### 6. `tools/call`: Ajv validate, then authorize, then handler

- Resolve the tool by MCP name (`<connector id>_<tool name>`). Unknown tool → short English MCP error; handler not called.
- Validate `arguments` against the tool JSON Schema **plus** the injected `account` property, using **Ajv** (new server dependency). Schema validation failure → short English MCP error; handler not called; fake call counter stays at zero.
- After schema success, check `account`: must be in the active configuration's `accountIds`, account `enabled`, and `connector` matches the tool's connector. Otherwise short English MCP error; do not call the handler (covers absent from configuration, foreign account, disabled account).
- On success: remove `account` from the arguments object passed to the handler; pass decrypted account field values (full stored `values`) alongside.
- If the handler throws: do not forward exception text; return a fixed English MCP error message. Secrets from the exception MUST NOT appear in the client message.

**Alternative (rejected):** hand-rolled schema checks without Ajv — rejected; person locked Ajv.
**Alternative (rejected):** forward handler error messages — rejected; fixed English message only.

### 7. Handler signature (native)

- Handler receives: (1) model arguments with `account` removed; (2) decrypted account field values.
- Network client restricted to allowed hosts is out of scope for this change (non-goal); do not add it to the handler yet.
- Handler return value is whatever the MCP tool result mapping needs for a successful call in this stack; keep it minimal and consistent with `@modelcontextprotocol/sdk` tool results.

### 8. Verification (automated, fake only)

- Two configurations: one whose `accountIds` include the fake account, one that does not.
- Successful `tools/call` with an eligible account increments a fake call counter; handler observes decrypted field values (including a secret fixture known to the test).
- Refusal cases (account absent from configuration, foreign account, disabled account, schema validation failure) leave the counter at zero.
- No live provider. No UI / browser in this change's apply verification contract (artifact e2e remains a later validator concern if needed; product UI unchanged).

## Risks / Trade-offs

- [Ajv version / draft mismatch with schemas connectors write] → Mitigation: pin Ajv; fake tool schema in tests uses a simple draft the team standardizes on; document the expected schema shape in the connector contract delta.
- [Existing empty-list tests assume zero registered tools] → Mitigation: keep production empty registry; empty-list scenario stays; new scenarios inject a fake registry.
- [authenticateBearer today returns boolean only] → Mitigation: add a resolve helper that still full-scans for timing-safe accept and records the first enabled match for dispatch; do not weaken 401 identity.
- [Handler throws containing secrets] → Mitigation: fixed English error only; never stringify the exception into the MCP error.

## Migration Plan

- Single process restart after merge; no store document migration.
- Clients that already authenticate still see `tools/list: []` until a non-empty registry and eligible accounts exist (production stays empty in this change).
- Rollback: revert the change branch / PR.

## Open Questions

None. The accepted decisions above close tool module shape, MCP naming, registry rejection of `account` in author schemas, first enabled configuration match, per-request list filtering, enum + description label format (issue «Решить в дизайне»), Ajv validation, authorization before handler, handler argument stripping, fixed handler-error text, fake injection into the MCP app, and verification on the fake with two configurations.
