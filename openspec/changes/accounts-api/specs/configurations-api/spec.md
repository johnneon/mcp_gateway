# Spec Delta

## MODIFIED Requirements

### Requirement: Configurations document shape

The state document SHALL hold configurations under the key `configurations` as an array of objects with fields `id` (string), `name` (string), `tokenHash` (string), `enabled` (boolean), and `accountIds` (array of string account ids). When a stored configuration row lacks `accountIds`, the process SHALL treat it as `[]`. When the in-memory document is the empty object `{}` or the `configurations` key is absent, the configurations list SHALL be treated as empty. After any successful configurations mutation, the persisted document SHALL contain a `configurations` array. New configurations SHALL be created with `accountIds` set to `[]`.

#### Scenario: Empty document reads as an empty list

- **GIVEN** the store's in-memory document is `{}`
- **WHEN** the client performs `GET /api/configurations` on the admin app
- **THEN** the response status is 200
- **AND** the body parsed as JSON is an empty array

#### Scenario: Stored rows keep id, name, tokenHash, and enabled only

- **GIVEN** a configuration was created through `POST /api/configurations`
- **WHEN** the store document is read after the create
- **THEN** the matching entry under `configurations` has string fields `id`, `name`, and `tokenHash`, boolean field `enabled`, and array field `accountIds`
- **AND** `accountIds` is an empty array
- **AND** the entry has no plaintext `token` property

#### Scenario: Missing accountIds on an existing row reads as empty

- **GIVEN** the store document contains a configuration object that has `id`, `name`, `tokenHash`, and `enabled` but no `accountIds` property
- **WHEN** the client performs `GET /api/configurations`
- **THEN** the response status is 200
- **AND** that configuration's `accountIds` in the JSON body is an empty array

### Requirement: Bearer token generation and hash persistence

On create and on rotate, the process SHALL generate a bearer token of exactly 32 cryptographically random bytes, encoded as a base64url string without padding. The process SHALL persist only the SHA-256 digest of that exact token string (hex lowercase) as `tokenHash`. The plaintext token SHALL appear only in the create and rotate HTTP response bodies and SHALL NOT be written into the store document. A compare helper SHALL hash a candidate string the same way and compare digests with `crypto.timingSafeEqual`; this change SHALL NOT expose that helper over HTTP or MCP.

#### Scenario: Create returns a token once and stores only the hash

- **GIVEN** the admin app is created with a store whose document is `{}`
- **WHEN** the client performs `POST /api/configurations` with `Content-Type: application/json` and body `{ "name": "Ops" }`
- **THEN** the response status is 201
- **AND** the body has string fields `id`, `name`, and `token`, `enabled` is `true`, and `accountIds` is an empty array
- **AND** `name` equals `Ops`
- **AND** `token` is a non-empty base64url string
- **AND** the store document's matching entry has `tokenHash` equal to the SHA-256 hex digest of that `token` string
- **AND** the store document does not contain the plaintext `token` string

#### Scenario: Rotate replaces the hash immediately

- **GIVEN** a configuration exists with a known previous token from create
- **WHEN** the client performs `POST /api/configurations/:id/rotate` with `Content-Type: application/json`
- **THEN** the response status is 200
- **AND** the body includes a new `token` string different from the previous token
- **AND** the body includes `accountIds`
- **AND** the store entry's `tokenHash` equals the SHA-256 hex digest of the new token
- **AND** the store entry's `tokenHash` is not equal to the SHA-256 hex digest of the previous token

### Requirement: Create configuration

`POST /api/configurations` on the admin port SHALL accept a JSON body validated as `{ name: string }` where `name` is a non-empty string after trim. On success the response SHALL be status 201 with body `{ id, name, enabled: true, accountIds: [], token }` and no `tokenHash`. A new configuration SHALL be created with `enabled` set to `true` and `accountIds` set to `[]`.

#### Scenario: Successful create

- **GIVEN** the admin app with a store
- **WHEN** the client performs `POST /api/configurations` with `Content-Type: application/json` and body `{ "name": "Primary" }`
- **THEN** the response status is 201
- **AND** the JSON body has `name` equal to `Primary`, `enabled` equal to `true`, `accountIds` equal to `[]`, and string fields `id` and `token`
- **AND** the body has no `tokenHash` property

#### Scenario: Empty name is rejected without changing state

- **GIVEN** the admin app with a store whose configurations list is empty
- **WHEN** the client performs `POST /api/configurations` with `Content-Type: application/json` and body `{ "name": "   " }`
- **THEN** the response status is 400
- **AND** a subsequent `GET /api/configurations` returns an empty array

### Requirement: List configurations without secrets

`GET /api/configurations` on the admin port SHALL return status 200 and a JSON array of objects `{ id, name, enabled, accountIds }` only. Each object SHALL NOT include `token` or `tokenHash`.

#### Scenario: List omits token and hash

- **GIVEN** at least one configuration was created and the create response token is known to the test
- **WHEN** the client performs `GET /api/configurations`
- **THEN** the response status is 200
- **AND** every array element has `id`, `name`, `enabled`, and `accountIds` and has neither `token` nor `tokenHash`
- **AND** the serialized response body does not contain the create response token string
- **AND** the serialized response body does not contain any configuration's `tokenHash` from the store

### Requirement: Enable or disable a configuration

`PATCH /api/configurations/:id` on the admin port SHALL accept a JSON body validated as `{ enabled: boolean }` and SHALL update that field on the matching configuration. On success the response SHALL be status 200 with body `{ id, name, enabled, accountIds }` and no `token` or `tokenHash`. If no configuration has that `id`, the response SHALL be status 404 with a short English body and no secrets.

#### Scenario: Disable then enable

- **GIVEN** a configuration exists with `enabled` true
- **WHEN** the client performs `PATCH /api/configurations/:id` with `Content-Type: application/json` and body `{ "enabled": false }`
- **THEN** the response status is 200
- **AND** the JSON body has `enabled` equal to `false`, the same `id` and `name`, and an `accountIds` array
- **AND** the body has neither `token` nor `tokenHash`
- **AND** when the client then performs `PATCH` with `{ "enabled": true }`, the response body has `enabled` equal to `true` and includes `accountIds`

#### Scenario: Unknown id on PATCH — 404

- **GIVEN** the admin app with a store and no configuration with id `missing`
- **WHEN** the client performs `PATCH /api/configurations/missing` with `Content-Type: application/json` and body `{ "enabled": false }`
- **THEN** the response status is 404
- **AND** the response body is short English text with no secrets

### Requirement: Rotate returns a new token once

`POST /api/configurations/:id/rotate` on the admin port SHALL replace `tokenHash` immediately and respond with status 200 and a JSON body that includes the new plaintext `token` once, together with `id`, `name`, `enabled`, and `accountIds`, and SHALL NOT include `tokenHash`. If no configuration has that `id`, the response SHALL be status 404 with a short English body and no secrets.

#### Scenario: Rotate unknown id — 404

- **GIVEN** the admin app with a store and no configuration with id `missing`
- **WHEN** the client performs `POST /api/configurations/missing/rotate` with `Content-Type: application/json`
- **THEN** the response status is 404
- **AND** the response body is short English text with no secrets

#### Scenario: Rotate success includes accountIds

- **GIVEN** a configuration exists with `accountIds` containing at least one known account id
- **WHEN** the client performs `POST /api/configurations/:id/rotate` with `Content-Type: application/json`
- **THEN** the response status is 200
- **AND** the JSON body includes `token`, `id`, `name`, `enabled`, and `accountIds` matching the stored list
- **AND** the body has no `tokenHash` property
