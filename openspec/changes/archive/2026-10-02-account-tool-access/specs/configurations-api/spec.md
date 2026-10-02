# Spec Delta

## ADDED Requirements

### Requirement: Configuration disabledTools denylist

A configuration row in the state document MAY include `disabledTools`, an object whose keys are account ids and whose values are arrays of MCP tool name strings. The process SHALL NOT store an allowlist of enabled tools. When `disabledTools` is absent, when an account id has no key, or when that key's array is empty, every tool of that account's connector SHALL be treated as enabled. A tool name that is not in the stored array SHALL stay enabled, including a tool added to the connector after the array was written. New configurations SHALL be created without a `disabledTools` property. Public JSON from create, list, patch, rotate, and account-assignment PUT SHALL NOT include `disabledTools`, `token`, or `tokenHash`.

#### Scenario: Missing disabledTools leaves the configuration readable

- **GIVEN** the store document contains a configuration object that has `id`, `name`, `tokenHash`, `enabled`, and `accountIds` and has no `disabledTools` property
- **WHEN** the client performs `GET /api/configurations`
- **THEN** the response status is 200
- **AND** that configuration is present with its `accountIds`
- **AND** the JSON body has no `disabledTools` property
- **AND** the JSON body has no `token` or `tokenHash`

#### Scenario: Create does not write a denylist

- **GIVEN** the admin app with a store whose configurations list is empty
- **WHEN** the client performs `POST /api/configurations` with `Content-Type: application/json` and body `{ "name": "Primary" }`
- **THEN** the response status is 201
- **AND** the response body has no `disabledTools` property
- **AND** the stored configuration row has no `disabledTools` property
