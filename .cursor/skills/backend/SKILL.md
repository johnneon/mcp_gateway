---
name: backend
description: Implements the MCP Gateway server on Node.js and TypeScript — MCP Streamable HTTP, SQLite, secret encryption, the admin API, and a connector module. Use when editing server/, MCP tools, persistence, encryption, admin API, or a connector.
---

# Backend

One process. Server code lives in `server/`. Behavior comes from the accepted change delta, not from this skill.

## Frame

- Node.js 22, TypeScript, `@modelcontextprotocol/sdk`, Streamable HTTP transport. No separate SSE endpoint.
- SQLite is one file in the directory given by the environment.
- Connector secrets use AES-GCM. The key comes only from the environment.
- If a required environment variable is missing, the process exits non-zero and prints the variable name. Do not print the value.
- `GET /health` requires no authentication. The body contains no data directory and no secrets.

## Access boundary

- MCP uses `Authorization: Bearer`. The database stores only a peppered hash of the token. Compare the hash in constant time.
- An empty token and an unknown token get the same rejection, with no client list.
- Admin auth is a session cookie: `HttpOnly`, `SameSite=Lax`. A bearer does not open the admin UI. An admin session does not call MCP.

## Connector

A connector is a code module added by a specific change.

- The host is fixed in the module. Do not follow a redirect to another host.
- Tool names and schemas are fixed by that change. The client does not register tools.
- Model arguments contain no URL, host, or secret. A foreign or disabled account id is rejected before any outbound call.
- A secret is decrypted only for the outbound call. The MCP response, the MCP error, the activity log, and the admin API do not contain it.
- Timeout and response size limit are set in code. The client error is short, in English, and contains no provider headers or body.

Do not add a runtime connector catalog or arbitrary HTTP built from model arguments.
