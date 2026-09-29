# connector-gmail e2e helpers

Throwaway scripts used by the validator. Not part of the product. Do not contact live Gmail.

- `fake-mail.mjs` — in-process fake IMAP/SMTP duplexes and Gmail-host fake egress transport.
- `fake-gmail-harness.mjs` — listens with `createAdminApp` + `createMcpApp`, production Gmail registry, and fake egress. Env: `IMAP_ACCEPT`, `SMTP_ACCEPT`, `SEED_ACCOUNT`.
- `mcp-gmail-client.mjs` — MCP and admin API scenario walk against fakes.

Run from the repository root after `npm run build`.
