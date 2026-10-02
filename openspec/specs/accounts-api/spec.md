# accounts-api Specification

## Purpose
Defines the accounts domain on the encrypted store and the admin-port HTTP API that creates, lists, patches, checks, and deletes accounts, redacts secret field values from responses, and assigns accounts to configurations after a successful connector connection check.

## Requirements

### Requirement: Accounts document shape

The state document SHALL hold accounts under the key `accounts` as an array of objects with fields `id` (string UUID), `connector` (string connector id from the in-code registry), `label` (non-empty string after trim), `values` (object of string field values keyed by connector field names), and `enabled` (boolean). When the in-memory document is `{}` or the `accounts` key is absent, the accounts list SHALL be treated as empty. After any successful accounts mutation, the persisted document SHALL contain an `accounts` array. A connector SHALL NOT be stored as a row in the state file; only account instances that reference a connector id SHALL be stored.

#### Scenario: Empty document reads as an empty accounts list

- **GIVEN** the store's in-memory document is `{}`
- **WHEN** the client performs `GET /api/accounts` on the admin app
- **THEN** the response status is 200
- **AND** the body parsed as JSON is an empty array

#### Scenario: Stored account keeps id, connector, label, values, and enabled

- **GIVEN** the admin app is created with a registry containing one fake native connector and a store
- **WHEN** the client successfully creates an account through `POST /api/accounts`
- **THEN** the matching entry under `accounts` has string fields `id`, `connector`, and `label`, object field `values`, and boolean field `enabled`
- **AND** `enabled` is `true`
- **AND** `id` is a UUID string

### Requirement: List accounts without secret values

`GET /api/accounts` on the admin port SHALL return status 200 and a JSON array of public account objects. Each object SHALL include `id`, `connector`, `label`, `enabled`, and `values`. For every connector field whose type is `secret`, the corresponding key SHALL be absent from the `values` object in the response (not present as an empty string). Non-secret field values SHALL be included. The serialized response body SHALL NOT contain any stored secret field value.

#### Scenario: Secret keys are absent from list values

- **GIVEN** the admin app with a fake native connector that declares a required `secret` field named `token` and a required `text` field named `user`
- **AND** an account was created with `values` containing `token` set to a fixture secret string known to the test and `user` set to `alice`
- **WHEN** the client performs `GET /api/accounts`
- **THEN** the response status is 200
- **AND** the matching element's `values` has `user` equal to `alice` and has no `token` property
- **AND** the serialized response body does not contain the fixture secret string

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

### Requirement: Delete account removes it from configurations

`DELETE /api/accounts/:id` on the admin port SHALL remove the matching account, remove that id from every configuration's `accountIds` array, and remove that id's key from every configuration's `disabledTools` object when the key is present, then respond with status 204 and an empty body. A disabled account that remains in `accountIds` SHALL stay listed until delete. Unknown id SHALL yield status 404 with short English plain text and no secrets.

#### Scenario: Delete cascades out of configuration accountIds

- **GIVEN** an account with id `a1` exists and a configuration includes `a1` in `accountIds`
- **WHEN** the client performs `DELETE /api/accounts/a1` with `Content-Type: application/json`
- **THEN** the response status is 204
- **AND** a subsequent `GET /api/accounts` does not include `a1`
- **AND** a subsequent `GET /api/configurations` shows that configuration's `accountIds` without `a1`

#### Scenario: Delete drops the account disabledTools entry

- **GIVEN** an account `a1` exists and configuration `c1` includes `a1` in `accountIds` and stores `disabledTools` with key `a1` whose array is `["fake_drop"]`
- **WHEN** the client performs `DELETE /api/accounts/a1` with `Content-Type: application/json`
- **THEN** the response status is 204
- **AND** the stored configuration `c1` has no `disabledTools` key `a1`

#### Scenario: Unknown account id on DELETE — 404

- **GIVEN** the admin app with a store and no account with id `missing`
- **WHEN** the client performs `DELETE /api/accounts/missing` with `Content-Type: application/json`
- **THEN** the response status is 404
- **AND** the response body is short English text with no secrets

### Requirement: Assign accounts to a configuration

`PUT /api/configurations/:id/accounts` on the admin port SHALL accept a JSON body `{ accountIds: string[] }` and replace that configuration's `accountIds` with the submitted list, preserving order. Duplicate ids in the submitted list SHALL yield status 400 and SHALL NOT write. An unknown account id SHALL yield status 400 and SHALL NOT write. Assigning a disabled account SHALL be allowed. Unknown configuration id SHALL yield status 404 with short English plain text. On success the response SHALL be status 200 with a public configuration object that includes `id`, `name`, `enabled`, and `accountIds`, and SHALL NOT include `token`, `tokenHash`, or `disabledTools`. When the replacement list omits an account id, the process SHALL remove that id's key from that configuration's `disabledTools` if the key is present. Account ids that remain in the list SHALL keep their stored `disabledTools` arrays. An account id that is added and has no `disabledTools` key SHALL stay without a key, so every tool of that account is enabled.

#### Scenario: Replace accountIds preserving order

- **GIVEN** accounts `a1` and `a2` exist and a configuration `c1` exists with `accountIds` `[]`
- **WHEN** the client performs `PUT /api/configurations/c1/accounts` with `Content-Type: application/json` and body `{ "accountIds": ["a2", "a1"] }`
- **THEN** the response status is 200
- **AND** the JSON body has `accountIds` equal to `["a2", "a1"]`
- **AND** the store entry for `c1` has `accountIds` equal to `["a2", "a1"]`

#### Scenario: Unknown account id rejects without write

- **GIVEN** a configuration `c1` exists with `accountIds` `[]`
- **WHEN** the client performs `PUT /api/configurations/c1/accounts` with body `{ "accountIds": ["missing"] }`
- **THEN** the response status is 400
- **AND** a subsequent `GET /api/configurations` still shows `c1` with `accountIds` equal to `[]`

#### Scenario: Duplicate account ids rejected

- **GIVEN** an account `a1` exists and a configuration `c1` exists
- **WHEN** the client performs `PUT /api/configurations/c1/accounts` with body `{ "accountIds": ["a1", "a1"] }`
- **THEN** the response status is 400
- **AND** the configuration's stored `accountIds` are unchanged

#### Scenario: Disabled account may be assigned

- **GIVEN** an account `a1` exists with `enabled` false and a configuration `c1` exists
- **WHEN** the client performs `PUT /api/configurations/c1/accounts` with body `{ "accountIds": ["a1"] }`
- **THEN** the response status is 200
- **AND** the JSON body has `accountIds` equal to `["a1"]`

#### Scenario: Unassign drops disabledTools and assign again starts enabled

- **GIVEN** accounts `a1` and `a2` exist and configuration `c1` has `accountIds` `["a1", "a2"]` and `disabledTools` key `a1` equal to `["fake_drop"]` and key `a2` equal to `["fake_keep"]`
- **WHEN** the client performs `PUT /api/configurations/c1/accounts` with body `{ "accountIds": ["a2"] }`
- **THEN** the response status is 200
- **AND** the stored `disabledTools` for `c1` has no key `a1`
- **AND** the stored `disabledTools` key `a2` is still `["fake_keep"]`
- **WHEN** the client performs `PUT /api/configurations/c1/accounts` with body `{ "accountIds": ["a2", "a1"] }`
- **THEN** the response status is 200
- **AND** the stored `disabledTools` for `c1` still has no key `a1`
- **AND** `GET /api/configurations/c1/accounts/a1/disabled-tools` returns `{ "toolNames": [] }`

### Requirement: Read and replace disabled tools for an assigned account

`GET /api/configurations/:id/accounts/:accountId/disabled-tools` and `PUT /api/configurations/:id/accounts/:accountId/disabled-tools` on the admin port SHALL read and replace the disabled-tool set for one account on one configuration. PUT SHALL accept a JSON body `{ toolNames: string[] }` and SHALL replace that account's whole set with the submitted names, preserving order. An empty array SHALL mean every tool of that account's connector is enabled and a following GET SHALL return `{ "toolNames": [] }`. GET SHALL return status 200 and `{ "toolNames": string[] }` equal to the stored names, or `{ "toolNames": [] }` when `disabledTools` is absent or has no key for that account. The account id SHALL be a member of that configuration's `accountIds`; otherwise the response SHALL be status 400 with short English text and PUT SHALL NOT write. Every submitted name SHALL be an MCP tool name of that account's connector (connector id, underscore, short tool name); a name of another connector, an unknown name, an empty string, or a duplicate SHALL yield status 400 and SHALL NOT write. Unknown configuration id SHALL yield status 404 with short English text. The response bodies SHALL NOT include a bearer token, a token hash, an account secret, or any account field value. PUT SHALL require `Content-Type` `application/json` under the existing admin rule; a missing or non-JSON media type SHALL yield status 415 and SHALL NOT write.

#### Scenario: GET returns an empty list when nothing is stored

- **GIVEN** account `a1` of connector `fake` is in configuration `c1`'s `accountIds` and `c1` has no `disabledTools` property
- **WHEN** the client performs `GET /api/configurations/c1/accounts/a1/disabled-tools`
- **THEN** the response status is 200
- **AND** the JSON body is `{ "toolNames": [] }`
- **AND** the serialized response body does not contain a bearer token or an account secret

#### Scenario: PUT replaces the set and GET returns the stored names

- **GIVEN** account `a1` of connector `fake` is in configuration `c1`'s `accountIds` and the fake connector's MCP tool names include `fake_keep` and `fake_drop`
- **WHEN** the client performs `PUT /api/configurations/c1/accounts/a1/disabled-tools` with `Content-Type: application/json` and body `{ "toolNames": ["fake_drop"] }`
- **THEN** the response status is 200
- **AND** the JSON body is `{ "toolNames": ["fake_drop"] }`
- **AND** the stored `disabledTools` key `a1` is `["fake_drop"]`
- **AND** a subsequent GET returns `{ "toolNames": ["fake_drop"] }`

#### Scenario: Empty array enables every tool

- **GIVEN** account `a1` is assigned to configuration `c1` and `disabledTools` key `a1` is `["fake_drop"]`
- **WHEN** the client performs `PUT /api/configurations/c1/accounts/a1/disabled-tools` with body `{ "toolNames": [] }`
- **THEN** the response status is 200
- **AND** the JSON body is `{ "toolNames": [] }`
- **AND** a subsequent GET returns `{ "toolNames": [] }`

#### Scenario: Duplicate tool names reject without write

- **GIVEN** account `a1` of connector `fake` is assigned to configuration `c1` and the fake connector's MCP tool names include `fake_drop`
- **AND** `c1` has no `disabledTools` key `a1`
- **WHEN** the client performs `PUT /api/configurations/c1/accounts/a1/disabled-tools` with body `{ "toolNames": ["fake_drop", "fake_drop"] }`
- **THEN** the response status is 400
- **AND** the stored configuration still has no `disabledTools` key `a1`

#### Scenario: Unknown tool name rejects without write

- **GIVEN** account `a1` of connector `fake` is assigned to configuration `c1` and `c1` has no `disabledTools` key `a1`
- **WHEN** the client performs `PUT /api/configurations/c1/accounts/a1/disabled-tools` with body `{ "toolNames": ["other_drop"] }`
- **THEN** the response status is 400
- **AND** the stored configuration still has no `disabledTools` key `a1`

#### Scenario: Account not assigned rejects without write

- **GIVEN** account `a1` exists and configuration `c1` has `accountIds` that do not include `a1`
- **WHEN** the client performs `PUT /api/configurations/c1/accounts/a1/disabled-tools` with body `{ "toolNames": [] }`
- **THEN** the response status is 400
- **AND** the stored configuration has no `disabledTools` key `a1`
- **WHEN** the client performs `GET /api/configurations/c1/accounts/a1/disabled-tools`
- **THEN** the response status is 400

#### Scenario: Unknown configuration is 404

- **GIVEN** the admin app with a store and no configuration with id `missing`
- **WHEN** the client performs `GET /api/configurations/missing/accounts/a1/disabled-tools`
- **THEN** the response status is 404
- **AND** the response body is short English text with no secrets

#### Scenario: Non-JSON PUT does not write

- **GIVEN** account `a1` is assigned to configuration `c1` and no disabled tools are stored for `a1`
- **WHEN** the client performs `PUT /api/configurations/c1/accounts/a1/disabled-tools` with `Content-Type: text/plain` and body `{ "toolNames": ["fake_drop"] }`
- **THEN** the response status is 415
- **AND** a subsequent GET returns `{ "toolNames": [] }`

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
