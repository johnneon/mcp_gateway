# accounts-ui e2e helpers

Throwaway scripts used by the validator. Not part of the product.

- `fake-admin-harness.mjs` — listens with `createAdminApp` + fake native connector (empty production registry cannot exercise account UI).
- `mcp-smoke.mjs` — creates a configuration, runs MCP `tools/list` and bearer rejection checks without printing the token.

Run from the repository root after `npm run build`.
