# E2E evidence — connector-contract

Captured against a live process with production empty registry
(MCP_PORT=18791, ADMIN_PORT=18792, temp DATA_DIR, test ENCRYPTION_KEY).

## Empty Connectors UI (Playwright MCP)

- URL stayed `http://127.0.0.1:18792/` (no client router).
- Nav: Configurations, Connectors.
- After opening Connectors:
  - Heading: Connectors
  - Copy: `No connectors yet. Connector accounts will appear here in a later change.`
  - Network: `GET /api/connectors` → 200
  - No account action buttons (add/edit/check/disable/delete).
- DOM scan: no fixture secrets or encryption key material.
- Console: only expected favicon.ico 404.

## Fake registry (injectable createAdminApp, not live product)

- `GET /api/connectors` → 200 with public Fake connector fields only.
- Body omitted destination hosts/ports, `allowedDestinations`, `checkConnection`.

## MCP / port separation

- MCP `/api/connectors` → 404
- Admin `/mcp` → 404
- Empty and unknown bearer → Unauthorized (same class)
- Valid bearer `tools/list` → `{ "tools": [] }`, token absent from body
