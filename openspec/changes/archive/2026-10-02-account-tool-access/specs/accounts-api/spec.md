# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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
