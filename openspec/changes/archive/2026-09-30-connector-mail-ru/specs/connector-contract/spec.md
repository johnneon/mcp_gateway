# Spec Delta

## MODIFIED Requirements

### Requirement: Production registry includes registered product connectors

The production connector registry export SHALL be a built registry that includes every product connector module registered in code for this process (including Gmail and Mail.ru). Tests that need a fake connector SHALL pass their own registry into the admin or MCP app factory and SHALL NOT rely on the production export containing that fake.

#### Scenario: Production export includes Gmail

- **GIVEN** the production connector registry module
- **WHEN** its public connector list is read
- **THEN** the list length is at least 1
- **AND** the list includes a connector with `id` `gmail`

#### Scenario: Tests inject a fake instead of using production for fake assertions

- **GIVEN** a test that needs a fake native connector id that is not a product connector
- **WHEN** the admin or MCP app is created for that test
- **THEN** the test passes a registry built with that fake into the app factory
- **AND** the production registry export is not required to contain that fake

#### Scenario: Production export includes Mail.ru alongside Gmail

- **GIVEN** the production connector registry module
- **WHEN** its public connector list is read
- **THEN** the list includes a connector with `id` `mailru`
- **AND** the list includes a connector with `id` `gmail`
