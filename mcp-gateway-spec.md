# MCP Gateway

Specification of a standalone application. The document is copied into the product repository as a whole. It does not refer to an outside host, network, compose file, or agents: the product does not know them. Where the process is deployed is decided outside this specification.

The admin UI, tool names, tool descriptions, and MCP error text are English.

## Purpose

The gateway is an MCP server (Streamable HTTP) through which a model works with external services: mail, trackers, knowledge bases. The gateway stores account credentials, calls the service itself, and returns only the result. The model never receives an account secret.

A service is connected by a connector. A connector is a module in the gateway code. In the UI the operator picks a connector and adds accounts to it, for example two Gmail mailboxes. A model connected to the gateway sees the connector's tools and the labels of the accounts available to it.

This specification defines the shared base: the store, access configurations, the connector contract, MCP, and the UI. Concrete connectors are not part of the base. Each one is added by a separate change on top of it.

## Stack

One process on Node.js (current LTS) and TypeScript.

- HTTP: Express 5.
- MCP: the `@modelcontextprotocol/sdk` package, Streamable HTTP transport. There is no separate SSE endpoint.
- UI: React, Vite, shadcn/ui, Tailwind. The same process serves the static build. There is no separate frontend service.
- Tests: Vitest on the server and in the UI.
- Data: one JSON file in a directory from the environment, encrypted as a whole. No separate database.

## Terms

| Term | Meaning |
| --- | --- |
| Connector | a code module: account fields, a connection check, tools, allowed hosts |
| Account | one connector instance with credentials, for example one Gmail mailbox |
| Configuration | MCP access: a name, a bearer token, and the set of accounts the model sees with that token |

## Call flow

```text
MCP client
  Authorization: Bearer <configuration token>
  tools/call { name, arguments }
        │
        ▼
gateway
  1. token hash → configuration; missing or disabled → reject
  2. tool from the connector list; arguments pass JSON Schema
  3. account is in the configuration and enabled
  4. account field values are decrypted in memory and passed only to the connector
  5. the connector calls only allowed hosts
  6. account secret values are removed from the result and from error text
        │
        ▼
client ← tool result
```

Model arguments contain no URL, host, or secret. Otherwise the request could be sent to another server together with the credentials.

## Data boundary

| What | Who sees it |
| --- | --- |
| Account secret fields, encryption key | only the gateway process and that account's connector |
| Configuration bearer | the operator once at creation and at rotation; the store keeps only the hash |
| Non-secret account fields (address, host) | the operator in the UI |
| Tool names and schemas, account labels | the model |
| Call arguments and response body | the model |

Credentials are hidden, not the service content. The model's response is the account's data.

Secret values do not appear in tool schemas, admin API responses, or MCP errors. If a service response happens to contain a secret, it is removed before the client receives it.

## Store

All state is one file in the data directory: configurations and accounts.

- The file is encrypted as a whole with AES-GCM. The key comes only from the environment.
- The process reads the file at startup and keeps state in memory. Each change writes the file again: first a temporary file, then a rename. Writes are serialized.
- If the file is missing, the process starts from an empty state. If the file cannot be decrypted or is corrupt, the process does not start and writes the reason without the key and without the contents.

## Configurations

| Field | Meaning |
| --- | --- |
| id | stable identifier |
| name | label in the UI |
| token hash | SHA-256 of a random token at least 32 bytes long; the token itself is not stored |
| enabled | a disabled configuration does not call tools |
| account ids | which accounts the model can use with this token |

The token is shown once: at creation and at rotation. Rotation invalidates the previous token immediately. Hash comparison takes constant time. An empty, unknown, or disabled token gets the same rejection, without listing configurations.

## Accounts

| Field | Meaning |
| --- | --- |
| id | stable identifier; the model passes it as `account` |
| connector | connector id from code |
| label | label the model sees, for example `Work Gmail` |
| values | values of the fields the connector describes; secret fields are not returned |
| enabled | a disabled account is not visible to the model and makes no outbound calls |

- Before saving, the gateway calls the connector's connection check. If the check fails, the account is not saved, and the error is short and contains no secret.
- On edit, an empty secret field means leave it unchanged. A new value goes through the check again.
- A deleted account disappears from every configuration.

## Connector

A connector is defined in code and added by a separate change. There is no connector catalog at runtime: the operator chooses only from what is in the code.

### Contract

Each connector declares:

| Part | Meaning |
| --- | --- |
| id | a string `[a-z0-9]+`, also the tool prefix |
| name | display name in the UI |
| account fields | name, label, type (`text`, `secret`, `host`), required |
| connection check | called before saving an account and from a button in the UI |
| allowed hosts | constants in code, or values of `host` fields the operator entered |
| kind | `native` or `proxy` |

The account form in the UI is built from the field description. A new connector does not need its own screen.

A `host` field is a hostname only, with no scheme, path, or credentials. The host comes from code or from an account field, and never from model arguments.

### Tools

- The MCP tool name is `<connector id>_<name>`, for example `gmail_list_messages`.
- The gateway adds a required `account` parameter to every tool. The schema lists ids and labels only of that connector's accounts that are enabled and included in the configuration.
- If a connector has no available accounts, its tools are absent from `tools/list`. If none are available, the list is empty.
- An unknown or disabled `account` is rejected before the connector is called.

### Kind `native`

Tools are written in the gateway code: name, description, JSON Schema of the arguments, handler.

- The handler receives decrypted account field values and a network client that allows only the permitted hosts.
- A redirect to another host is not followed.
- The timeout and the response size limit are set in code.

### Kind `proxy`

The connector starts a third-party MCP server and exposes a subset of its tools to the model.

- Transport is stdio. The server comes from a package pinned in the repository dependencies at an exact version. Downloading at startup (`npx` without an installed package) is forbidden.
- Each account has its own child process. It starts on the first call and stops after idle time. A crashed process is started again on the next call.
- The child environment is built from scratch: only the variables the connector maps from account fields, plus the minimum needed to start. Gateway variables, including the encryption key, are not passed in.
- Only tools listed as allowed in the connector code are exposed. The gateway removes the `account` parameter before forwarding the call to the child.
- An allowed tool does not accept a URL or a host in its arguments. The change that adds the connector checks this.
- The child's response and stderr are scrubbed of account secret values. stderr is not returned to the client.

The third-party server receives the account secret itself. The gateway does not restrict where that server connects. The package is therefore chosen and pinned in the connector's change.

## UI

The UI language is English. The product has no login: the UI port listens on the address from the environment (default `127.0.0.1`), and the operator's outer proxy protects that port.

The admin API accepts changes only with `Content-Type: application/json` and does not send CORS headers. A foreign page in the operator's browser therefore cannot send a request as the operator.

Screens:

1. Connectors — connectors from code. Each has an account list: add, edit, check the connection, disable, delete. No secrets on screen.
2. Configurations — list, create, show the token once, rotate, disable, delete, account checkboxes grouped by connector.

## HTTP

Two ports.

| Port | Path | Who |
| --- | --- | --- |
| MCP | `GET /health` | no authentication; process status, no catalog and no secrets |
| MCP | `/mcp` | MCP, header `Authorization: Bearer` |
| MCP | anything else | 404 |
| UI | `/api/*` | admin API |
| UI | anything else | `web` static files |

A configuration bearer does not open the admin API: that is a different port. The UI port does not speak MCP.

A service error returned to the client is short, in English, and contains no headers or bodies that could have held a secret.

## Environment

The repository contains only variable names, not values.

| Variable | Purpose |
| --- | --- |
| MCP address and port | `/mcp` and `/health` |
| UI address and port | the UI and its API; default address `127.0.0.1` |
| data directory | the encrypted state file |
| encryption key | AES-GCM for the state file |

If a required variable is missing, the process does not start and writes the missing name, without values.

## Repository layout

Two directories in one repository, one `package.json` via workspaces:

- `server` — MCP, admin API, store, connector contract, connectors;
- `web` — React.

The production artifact is one Node process: the API and the built `web`. A separate container for the UI is not required. A Dockerfile may appear in the product repository; binding to someone else's compose file is outside this specification.

Base implementation order:

1. Process: environment, encrypted store, two ports, `/health`.
2. Configurations in the API and in MCP with an empty `tools/list`.
3. UI: Configurations and an empty Connectors screen.
4. Connector contract and kind `native` on a fake connector: accounts, a form from fields, the check, `tools/list`, `tools/call`.
5. Kind `proxy` on a fake MCP server over stdio.

## Planned connectors

Not part of the base. Each is a separate change; that change chooses kind `native` or `proxy`.

| Connector | Credentials | Hosts |
| --- | --- | --- |
| Gmail | address and app password (IMAP/SMTP) | `imap.gmail.com:993`, `smtp.gmail.com:465` |
| Mail.ru | address and app password (IMAP/SMTP) | `imap.mail.ru:993`, `smtp.mail.ru:465` |
| Jira | host, email, API token | host from the account field |
| Notion | internal integration token | `api.notion.com` |

## Out of scope

- A call log. It will be a separate feature.
- A runtime connector catalog and arbitrary HTTP from a template in model arguments.
- The client enabling new tools by itself.
- A login inside the product, multiple administrators, and organizations.
- Connecting accounts with OAuth.
- Remote MCP servers over HTTP as kind `proxy`.
- Running code on the model's request.
- Publishing metrics. `GET /health` is enough.
- Deciding which host the process runs on. The product listens on the addresses from the environment and stops there.
