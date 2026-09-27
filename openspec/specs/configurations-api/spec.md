# configurations-api Specification

## Purpose
Defines the configurations domain on the encrypted store and the admin-port HTTP API that creates, lists, rotates, enables or disables, and deletes configurations, showing the bearer token once and persisting only its SHA-256 hash.

## Requirements

### Requirement: Configurations document shape

The state document SHALL hold configurations under the key `configurations` as an array of objects with fields `id` (string), `name` (string), `tokenHash` (string), and `enabled` (boolean). The document SHALL NOT include `accountIds` or any account-link field. When the in-memory document is the empty object `{}` or the `configurations` key is absent, the configurations list SHALL be treated as empty. After any successful configurations mutation, the persisted document SHALL contain a `configurations` array.

#### Scenario: Empty document reads as an empty list

- **GIVEN** the store's in-memory document is `{}`
- **WHEN** the client performs `GET /api/configurations` on the admin app
- **THEN** the response status is 200
- **AND** the body parsed as JSON is an empty array

#### Scenario: Stored rows keep id, name, tokenHash, and enabled only

- **GIVEN** a configuration was created through `POST /api/configurations`
- **WHEN** the store document is read after the create
- **THEN** the matching entry under `configurations` has string fields `id`, `name`, and `tokenHash`, and boolean field `enabled`
- **AND** the entry has no `accountIds` property and no plaintext `token` property

### Requirement: Bearer token generation and hash persistence

On create and on rotate, the process SHALL generate a bearer token of exactly 32 cryptographically random bytes, encoded as a base64url string without padding. The process SHALL persist only the SHA-256 digest of that exact token string (hex lowercase) as `tokenHash`. The plaintext token SHALL appear only in the create and rotate HTTP response bodies and SHALL NOT be written into the store document. A compare helper SHALL hash a candidate string the same way and compare digests with `crypto.timingSafeEqual`; this change SHALL NOT expose that helper over HTTP or MCP.

#### Scenario: Create returns a token once and stores only the hash

- **GIVEN** the admin app is created with a store whose document is `{}`
- **WHEN** the client performs `POST /api/configurations` with `Content-Type: application/json` and body `{ "name": "Ops" }`
- **THEN** the response status is 201
- **AND** the body has string fields `id`, `name`, and `token`, and `enabled` is `true`
- **AND** `name` equals `Ops`
- **AND** `token` is a non-empty base64url string
- **AND** the store document's matching entry has `tokenHash` equal to the SHA-256 hex digest of that `token` string
- **AND** the store document does not contain the plaintext `token` string

#### Scenario: Rotate replaces the hash immediately

- **GIVEN** a configuration exists with a known previous token from create
- **WHEN** the client performs `POST /api/configurations/:id/rotate` with `Content-Type: application/json`
- **THEN** the response status is 200
- **AND** the body includes a new `token` string different from the previous token
- **AND** the store entry's `tokenHash` equals the SHA-256 hex digest of the new token
- **AND** the store entry's `tokenHash` is not equal to the SHA-256 hex digest of the previous token

### Requirement: Create configuration

`POST /api/configurations` on the admin port SHALL accept a JSON body validated as `{ name: string }` where `name` is a non-empty string after trim. On success the response SHALL be status 201 with body `{ id, name, enabled: true, token }` and no `tokenHash`. A new configuration SHALL be created with `enabled` set to `true`.

#### Scenario: Successful create

- **GIVEN** the admin app with a store
- **WHEN** the client performs `POST /api/configurations` with `Content-Type: application/json` and body `{ "name": "Primary" }`
- **THEN** the response status is 201
- **AND** the JSON body has `name` equal to `Primary`, `enabled` equal to `true`, and string fields `id` and `token`
- **AND** the body has no `tokenHash` property

#### Scenario: Empty name is rejected without changing state

- **GIVEN** the admin app with a store whose configurations list is empty
- **WHEN** the client performs `POST /api/configurations` with `Content-Type: application/json` and body `{ "name": "   " }`
- **THEN** the response status is 400
- **AND** a subsequent `GET /api/configurations` returns an empty array

### Requirement: List configurations without secrets

`GET /api/configurations` on the admin port SHALL return status 200 and a JSON array of objects `{ id, name, enabled }` only. Each object SHALL NOT include `token` or `tokenHash`.

#### Scenario: List omits token and hash

- **GIVEN** at least one configuration was created and the create response token is known to the test
- **WHEN** the client performs `GET /api/configurations`
- **THEN** the response status is 200
- **AND** every array element has `id`, `name`, and `enabled` and has neither `token` nor `tokenHash`
- **AND** the serialized response body does not contain the create response token string
- **AND** the serialized response body does not contain any configuration's `tokenHash` from the store

### Requirement: Enable or disable a configuration

`PATCH /api/configurations/:id` on the admin port SHALL accept a JSON body validated as `{ enabled: boolean }` and SHALL update that field on the matching configuration. On success the response SHALL be status 200 with body `{ id, name, enabled }` and no `token` or `tokenHash`. If no configuration has that `id`, the response SHALL be status 404 with a short English body and no secrets.

#### Scenario: Disable then enable

- **GIVEN** a configuration exists with `enabled` true
- **WHEN** the client performs `PATCH /api/configurations/:id` with `Content-Type: application/json` and body `{ "enabled": false }`
- **THEN** the response status is 200
- **AND** the JSON body has `enabled` equal to `false` and the same `id` and `name`
- **AND** the body has neither `token` nor `tokenHash`
- **AND** when the client then performs `PATCH` with `{ "enabled": true }`, the response body has `enabled` equal to `true`

#### Scenario: Unknown id on PATCH — 404

- **GIVEN** the admin app with a store and no configuration with id `missing`
- **WHEN** the client performs `PATCH /api/configurations/missing` with `Content-Type: application/json` and body `{ "enabled": false }`
- **THEN** the response status is 404
- **AND** the response body is short English text with no secrets

### Requirement: Delete a configuration

`DELETE /api/configurations/:id` on the admin port SHALL remove the matching configuration and respond with status 204 and an empty body. If no configuration has that `id`, the response SHALL be status 404 with a short English body and no secrets.

#### Scenario: Successful delete

- **GIVEN** a configuration exists with a known `id`
- **WHEN** the client performs `DELETE /api/configurations/:id` with `Content-Type: application/json`
- **THEN** the response status is 204
- **AND** the response body is empty
- **AND** a subsequent `GET /api/configurations` does not include that `id`

#### Scenario: Unknown id on DELETE — 404

- **GIVEN** the admin app with a store and no configuration with id `missing`
- **WHEN** the client performs `DELETE /api/configurations/missing` with `Content-Type: application/json`
- **THEN** the response status is 404
- **AND** the response body is short English text with no secrets

### Requirement: Rotate returns a new token once

`POST /api/configurations/:id/rotate` on the admin port SHALL replace `tokenHash` immediately and respond with status 200 and a JSON body that includes the new plaintext `token` once, together with `id`, `name`, and `enabled`, and SHALL NOT include `tokenHash`. If no configuration has that `id`, the response SHALL be status 404 with a short English body and no secrets.

#### Scenario: Rotate unknown id — 404

- **GIVEN** the admin app with a store and no configuration with id `missing`
- **WHEN** the client performs `POST /api/configurations/missing/rotate` with `Content-Type: application/json`
- **THEN** the response status is 404
- **AND** the response body is short English text with no secrets

### Requirement: /api mutations require application/json Content-Type

For every non-GET request under `/api` on the admin port, if the `Content-Type` header is missing or its media type is not `application/json`, the process SHALL respond with status 415 and SHALL NOT change the store document. A `Content-Type` of `application/json; charset=utf-8` SHALL be accepted as `application/json`. A form-encoded body (`application/x-www-form-urlencoded`) SHALL be rejected with 415 without changing state.

#### Scenario: Form body create is rejected without changing state

- **GIVEN** the admin app with a store whose configurations list is empty
- **WHEN** the client performs `POST /api/configurations` with `Content-Type: application/x-www-form-urlencoded` and body `name=Ops`
- **THEN** the response status is 415
- **AND** a subsequent `GET /api/configurations` returns an empty array

#### Scenario: Missing Content-Type on PATCH does not change state

- **GIVEN** a configuration exists with `enabled` true
- **WHEN** the client performs `PATCH /api/configurations/:id` with body `{ "enabled": false }` and without a `Content-Type` header
- **THEN** the response status is 415
- **AND** a subsequent `GET /api/configurations` still shows that configuration with `enabled` true

#### Scenario: charset=utf-8 JSON is accepted

- **GIVEN** the admin app with a store
- **WHEN** the client performs `POST /api/configurations` with `Content-Type: application/json; charset=utf-8` and body `{ "name": "Charset" }`
- **THEN** the response status is 201
- **AND** the JSON body has `name` equal to `Charset`

### Requirement: No CORS headers on /api responses

No response for a path under `/api` on the admin port, including error responses (400, 404, 415, and other `/api` errors), SHALL include a CORS header (`Access-Control-Allow-Origin`, `Access-Control-Allow-Methods`, `Access-Control-Allow-Headers`, or `Access-Control-Allow-Credentials`).

#### Scenario: Successful list has no CORS headers

- **GIVEN** the admin app with a store
- **WHEN** the client performs `GET /api/configurations`
- **THEN** the response has none of the headers `Access-Control-Allow-Origin`, `Access-Control-Allow-Methods`, `Access-Control-Allow-Headers`, or `Access-Control-Allow-Credentials`

#### Scenario: 415 error has no CORS headers

- **GIVEN** the admin app with a store
- **WHEN** the client performs `POST /api/configurations` with `Content-Type: text/plain` and an arbitrary body
- **THEN** the response status is 415
- **AND** the response has none of the headers `Access-Control-Allow-Origin`, `Access-Control-Allow-Methods`, `Access-Control-Allow-Headers`, or `Access-Control-Allow-Credentials`

### Requirement: Token absent from plaintext on disk after create

After a successful create that writes the store to disk, the bytes of the state file SHALL NOT contain the plaintext token string returned in the create response.

#### Scenario: Create token is not in state.bin plaintext

- **GIVEN** a store backed by a real encrypted file under a test `DATA_DIR`
- **WHEN** the client creates a configuration through the admin API and receives a `token`
- **THEN** the contents of `DATA_DIR/state.bin` as a byte sequence do not contain that token string in the clear

### Requirement: MCP port stays unchanged

This change SHALL NOT alter MCP-port routing: `GET /mcp` and `POST /mcp` SHALL still return status 501. This change SHALL NOT add bearer authentication, `tools/list`, or Streamable HTTP on either port.

#### Scenario: GET /mcp remains 501

- **GIVEN** the MCP app is created through the factory without `listen`
- **WHEN** the client performs `GET /mcp`
- **THEN** the response status is 501
