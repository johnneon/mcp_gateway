# Spec Delta

## MODIFIED Requirements

### Requirement: Create account after connection check

`POST /api/accounts` on the admin port SHALL accept a JSON body `{ connector, label, values }` where `label` is a non-empty string after trim, `connector` is a known registry connector id, and `values` is an object of string values. The process SHALL validate fields against the connector description: required fields present and non-empty; unknown keys in `values` rejected; each `host` field value a hostname only (no scheme, path, userinfo, or port). The process SHALL then build the gateway egress client for that connector and the submitted `values` from the connector allowlist, and SHALL call the connector's `checkConnection` with the full submitted `values` and that egress client. On success the response SHALL be status 201 with a public account object (`id`, `connector`, `label`, `enabled: true`, `values` with secret keys absent) and the account SHALL be persisted with `enabled` true. An unknown connector id SHALL yield status 400 and SHALL NOT write. A failed connection check SHALL yield status 400 with the fixed plain-text body `Connection check failed`, SHALL NOT forward the connector exception text, and SHALL NOT save the account. The fixture secret SHALL NOT appear in any response body, including errors.

#### Scenario: Successful create after checkConnection

- **GIVEN** the admin app with a fake native connector whose `checkConnection` resolves for valid values when given an egress client
- **WHEN** the client performs `POST /api/accounts` with `Content-Type: application/json` and a body with that connector id, a non-empty label, and valid required values including a secret
- **THEN** the response status is 201
- **AND** the JSON body has `enabled` equal to `true`, matching `connector` and trimmed `label`, and `values` without secret keys
- **AND** the store document contains the full `values` including the secret
- **AND** the serialized response body does not contain the secret string

#### Scenario: Create passes egress client into checkConnection

- **GIVEN** the admin app with a fake native connector whose `checkConnection` records whether it received an egress client argument and resolves when the client is present
- **WHEN** the client performs `POST /api/accounts` with valid field shapes for that connector
- **THEN** the response status is 201
- **AND** `checkConnection` recorded that the egress client argument was present

#### Scenario: Unknown connector id is 400 without write

- **GIVEN** the admin app with a store whose accounts list is empty and a registry that does not include id `missing`
- **WHEN** the client performs `POST /api/accounts` with `Content-Type: application/json` and body `{ "connector": "missing", "label": "X", "values": {} }`
- **THEN** the response status is 400
- **AND** a subsequent `GET /api/accounts` returns an empty array

#### Scenario: Connection check failure does not save

- **GIVEN** the admin app with a fake native connector whose `checkConnection` rejects with an Error whose message contains a fixture secret string
- **WHEN** the client performs `POST /api/accounts` with valid field shapes for that connector
- **THEN** the response status is 400
- **AND** the response body is exactly the plain text `Connection check failed`
- **AND** the serialized response body does not contain the fixture secret string and does not contain the connector exception message beyond that fixed text
- **AND** a subsequent `GET /api/accounts` does not include a new account from that attempt

#### Scenario: Host value with scheme is rejected

- **GIVEN** the admin app with a fake native connector that declares a required `host` field
- **WHEN** the client performs `POST /api/accounts` with that host field set to `https://mail.example.test`
- **THEN** the response status is 400
- **AND** the account is not saved

#### Scenario: Unknown values key is rejected

- **GIVEN** the admin app with a fake native connector whose fields do not include `extra`
- **WHEN** the client performs `POST /api/accounts` with `values` containing key `extra`
- **THEN** the response status is 400
- **AND** the account is not saved

### Requirement: Patch account with secret keep semantics

`PATCH /api/accounts/:id` on the admin port SHALL accept a JSON body that may include `label`, `values`, and/or `enabled`. An empty string for a secret field in `values` SHALL mean keep the stored value. A missing key in `values` SHALL keep the stored value for that field. An empty string on a required non-secret field SHALL yield status 400. An empty string on an optional non-secret field SHALL store an empty string. Create-equivalent validation (unknown keys, host hostname-only, label non-empty after trim when provided) SHALL apply to the submitted patch. When the patch changes `label` or any effective `values` (after applying keep semantics), the process SHALL build the gateway egress client for that connector and the merged full values (including kept secrets), SHALL call `checkConnection` with those merged values and that egress client, and SHALL NOT persist on failure (status 400, body `Connection check failed`). A patch that changes only `enabled` SHALL NOT call `checkConnection`. On success the response SHALL be status 200 with the public account object (secret keys absent from `values`). Unknown id SHALL yield status 404 with short English plain text and no secrets.

#### Scenario: Empty secret on patch keeps stored value and rechecks

- **GIVEN** an account exists with a stored secret field `token` equal to a fixture secret and a fake connector whose `checkConnection` records the values and egress client it receives and resolves
- **WHEN** the client performs `PATCH /api/accounts/:id` with `Content-Type: application/json` and body `{ "values": { "token": "" } }` (and any other required non-secret fields omitted so they keep stored values)
- **THEN** the response status is 200
- **AND** `checkConnection` was invoked with the kept fixture secret for `token`
- **AND** `checkConnection` recorded that the egress client argument was present
- **AND** the store still holds the fixture secret for `token`
- **AND** the response `values` has no `token` property
- **AND** the serialized response body does not contain the fixture secret

#### Scenario: Enabled-only patch skips checkConnection

- **GIVEN** an account exists with `enabled` true and a fake connector whose `checkConnection` increments a call counter
- **WHEN** the client performs `PATCH /api/accounts/:id` with `Content-Type: application/json` and body `{ "enabled": false }`
- **THEN** the response status is 200
- **AND** the JSON body has `enabled` equal to `false`
- **AND** `checkConnection` was not called for that request

#### Scenario: Empty required non-secret on patch is 400

- **GIVEN** an account exists for a connector with a required `text` field named `user`
- **WHEN** the client performs `PATCH /api/accounts/:id` with body `{ "values": { "user": "" } }`
- **THEN** the response status is 400
- **AND** the stored `user` value is unchanged

### Requirement: Check connection without write

`POST /api/accounts/:id/check` on the admin port SHALL build the gateway egress client for the account's connector and stored values, run the connector's `checkConnection` with those stored values and that egress client, and SHALL NOT change the store document. On success the response SHALL be status 200 with a short English JSON or empty success body that includes no secret values. On connection-check failure the response SHALL be status 400 with the fixed plain-text body `Connection check failed` and SHALL NOT forward the connector exception text. Unknown id SHALL yield status 404 with short English plain text. The fixture secret SHALL NOT appear in any response body.

#### Scenario: Check succeeds without writing

- **GIVEN** an account exists and a fake connector whose `checkConnection` resolves when given an egress client
- **AND** the store document fingerprint (or accounts array reference) is noted
- **WHEN** the client performs `POST /api/accounts/:id/check` with `Content-Type: application/json`
- **THEN** the response status is 200
- **AND** the store document is unchanged
- **AND** the serialized response body does not contain any stored secret value

#### Scenario: Explicit check passes egress client

- **GIVEN** an account exists and a fake connector whose `checkConnection` records whether it received an egress client and resolves when the client is present
- **WHEN** the client performs `POST /api/accounts/:id/check` with `Content-Type: application/json`
- **THEN** the response status is 200
- **AND** `checkConnection` recorded that the egress client argument was present

#### Scenario: Check failure returns fixed body

- **GIVEN** an account exists and a fake connector whose `checkConnection` rejects with a message containing a fixture secret
- **WHEN** the client performs `POST /api/accounts/:id/check` with `Content-Type: application/json`
- **THEN** the response status is 400
- **AND** the response body is exactly `Connection check failed`
- **AND** the serialized response body does not contain the fixture secret

### Requirement: Accounts API follows admin JSON and CORS rules

Account and configuration-account mutations under `/api` SHALL require `Content-Type` whose media type is `application/json` (`charset=utf-8` accepted), matching the existing configurations admin rule. Missing or non-JSON Content-Type SHALL yield status 415 without changing the store. No response under these routes SHALL include CORS headers. The production connector registry MAY include product connectors; tests SHALL inject a fake native connector into the admin app factory when they need a fake.

#### Scenario: Form body create account is rejected

- **GIVEN** the admin app with a store whose accounts list is empty
- **WHEN** the client performs `POST /api/accounts` with `Content-Type: application/x-www-form-urlencoded` and an arbitrary body
- **THEN** the response status is 415
- **AND** a subsequent `GET /api/accounts` returns an empty array

#### Scenario: Successful accounts list has no CORS headers

- **GIVEN** the admin app with a store
- **WHEN** the client performs `GET /api/accounts`
- **THEN** the response has none of the headers `Access-Control-Allow-Origin`, `Access-Control-Allow-Methods`, `Access-Control-Allow-Headers`, or `Access-Control-Allow-Credentials`
