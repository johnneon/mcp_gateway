# Design

## Context

See `proposal.md` — Why. The encrypted store (`open` / `read` / `replace`) and the two HTTP apps already exist. `createAdminApp` today takes only an optional `webRoot` and serves static files after an explicit `/mcp` → 404. `main.ts` opens the store but discards the returned handle before `listen`. Vision: `mcp-gateway-spec.md` (Configurations, HTTP, data boundary). Current specs: `encrypted-store`, `process-startup`, `mcp-port-routing`. When the vision's implementation-order line pairs configurations with MCP `tools/list`, the accepted scope of issue #9 wins: admin API only.

## Goals / Non-Goals

**Goals:**

- Configurations CRUD and token rotation on the admin port over `/api/configurations`.
- Token shown once; store keeps SHA-256 only; timing-safe compare helper colocated with the token module.
- `/api` Content-Type gate and absence of CORS headers.
- Wire the opened store into `createAdminApp` from `main.ts`.

**Non-Goals:**

- MCP bearer lookup, empty `tools/list`, Streamable HTTP.
- Admin UI / Configurations screen, accounts, checkboxes, connectors, CORS, admin login.
- Changing `encrypted-store`, `process-startup`, or `mcp-port-routing` requirement text.

## Decisions

Accepted by the person before propose; they are not reopened here.

### 1. Document shape

- Shape: `{ configurations: [{ id, name, tokenHash, enabled }] }`.
- Missing `configurations` or document `{}` → empty list when reading.
- No `accountIds` field; accounts do not exist yet.
- After a successful mutation, `replace` writes a document that includes the `configurations` array (possibly empty after the last delete).

**Alternative (rejected):** add `accountIds: []` now for forward compatibility — rejected; accounts are a later change.

### 2. Token module

- Generate: `crypto.randomBytes(32)`, encode with base64url **without padding** (Node `buffer.toString('base64url')`).
- Persist: SHA-256 of the exact token string, digest as **lowercase hex** (64 characters).
- Compare helper: hash the candidate the same way; compare the two digests with `crypto.timingSafeEqual` on equal-length buffers. Lives next to generate/hash even though this change has no MCP lookup.
- `id`: `crypto.randomUUID()`.

**Alternative (rejected):** store the raw 32 bytes and hash those bytes — rejected; hash the exact token string the client receives.

### 3. Layering: service without Express

```text
server/src/
  token/          generate, hash, timingSafeEqual compare
  configurations/ service: list/create/rotate/setEnabled/remove; read/replace on EncryptedStore
  http/
    createAdminApp.ts   mounts /api then /mcp 404 then static
    api/                Express routers; zod for bodies; calls the service
  main.ts               const store = await open(...); createAdminApp({ store })
```

- The configurations service takes `EncryptedStore` and returns plain results or typed domain errors (not found, validation). It does not import Express.
- Routes map domain errors to HTTP status codes (400 validation, 404 missing id, 204 delete).
- zod schemas: create `{ name: z.string().trim().min(1) }`, patch `{ enabled: z.boolean() }`.

**Alternative (rejected):** put store reads/writes inside route handlers — rejected; keeps HTTP and domain separate for fake-store tests of the service if needed, and matches "service has no Express".

### 4. HTTP routes (admin port)

| Method | Path | Success |
| --- | --- | --- |
| POST | `/api/configurations` | 201 `{ id, name, enabled: true, token }` |
| GET | `/api/configurations` | 200 `[{ id, name, enabled }, ...]` |
| POST | `/api/configurations/:id/rotate` | 200 `{ id, name, enabled, token }` |
| PATCH | `/api/configurations/:id` | 200 `{ id, name, enabled }` |
| DELETE | `/api/configurations/:id` | 204 empty body |

- Mount under `/api` **before** the `/mcp` 404 handler and static files.
- Unknown `:id` → 404, `text/plain; charset=utf-8`, body `Not Found`.
- English error text only; never echo token or hash in errors.

### 5. Content-Type and CORS for entire `/api`

- Every **non-GET** request whose path starts with `/api` MUST have `Content-Type` whose media type is `application/json`. Parameters such as `charset=utf-8` are allowed (`application/json; charset=utf-8`).
- Missing header, `application/x-www-form-urlencoded`, `text/plain`, or any other media type → **415**, no `replace` call.
- Middleware runs before JSON body parsing and before route handlers so a form body cannot mutate state.
- Rotate and DELETE still require the JSON Content-Type header even when the body is empty.
- Do not call `cors()` or set `Access-Control-*` on any `/api` response, including errors.

**Alternative (rejected):** require Content-Type only when a body is present — rejected; the accepted rule is all mutations.

### 6. Factory and main wiring

- `createAdminApp({ store, webRoot? })` — `store` is required (`EncryptedStore`).
- `main.ts`: `const store = await open(...); createAdminApp({ store })`.
- Existing admin tests (mcp-port-routing) pass an in-memory fake that implements `read` / `replace`.
- MCP factory and `/mcp` → 501 are untouched.

### 7. Tests (apply phase)

- Supertest against `createAdminApp({ store: fakeStore })` without `listen`.
- Fake store: in-memory `EncryptedStore` (and one scenario with a real encrypted file for the on-disk token canary).
- Cover: JSON create/list/rotate/patch/delete; form and missing Content-Type → 415 with no state change; charset=utf-8 accepted; token and hash absent from list; token absent from `state.bin` plaintext; no CORS headers; GET `/mcp` on MCP still 501.
- No Playwright / admin UI in this change.

## Risks / Trade-offs

- [DELETE/rotate require Content-Type without a body] → Mitigation: documented in specs; clients (and later the UI) always send `Content-Type: application/json`.
- [Existing `createAdminApp()` call sites break without a store] → Mitigation: update those tests to pass a fake store in the same apply tasks; production `main.ts` passes the real store.
- [Hash hex vs base64 for `tokenHash`] → Mitigation: fixed as lowercase hex in Decision 2; compare always re-hashes the candidate string.
- [Vision still mentions account ids and MCP tools/list with configurations] → Mitigation: non-goals and proposal record API-only scope; later changes add those.

## Migration Plan

Additive. Empty `{}` remains valid. Rollback is reverting the change's commits. No data migration.

## Open Questions

None. Decisions 1–7 were accepted before propose (or are mechanical details of those decisions). Do not reopen them.
