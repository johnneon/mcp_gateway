# Spec Delta

## MODIFIED Requirements

### Requirement: Shared mail protocol is separate from the Gmail connector

IMAP and SMTP protocol logic SHALL live in a shared module that speaks only over an already-connected egress duplex and accepts host and credential mapping from the caller. The Gmail connector SHALL supply hosts, field mapping, connection check, and tools, and SHALL NOT embed a second IMAP/SMTP stack. Automated tests of the shared module SHALL use fake IMAP and fake SMTP servers and SHALL NOT contact a live provider.

#### Scenario: Shared module authenticates over a duplex without opening its own TCP socket

- **GIVEN** a fake duplex connected to a fake IMAP server that accepts LOGIN
- **WHEN** the shared mail module performs IMAP LOGIN over that duplex with fixture credentials
- **THEN** LOGIN succeeds
- **AND** the module did not open a separate TCP or TLS socket outside the provided duplex
