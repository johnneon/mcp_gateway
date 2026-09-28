# MCP Gateway

The gateway stores account credentials for connectors and exposes MCP to clients. Code defines the connectors and their tools. A configuration's bearer token grants access to a chosen set of accounts. The model never receives an account secret.

**Before any task, read [`docs/workflow.md`](docs/workflow.md).** It defines the agent cycle, the roles, which skills to use at each step, and when a change is done.

Tasks are issues on the [Task tracker](https://github.com/users/johnneon/projects/2) board. Every change starts from one issue and moves its card through the cycle per the `tracker` skill.

## Stack

One Node.js 22 process, TypeScript. Tests run on Vitest.

- `server` — Express 5, MCP Streamable HTTP (`@modelcontextprotocol/sdk`), admin API, encrypted JSON store, connector contract, connectors.
- `web` — React and Vite, shadcn/ui, Tailwind. No separate frontend service. The same process serves the static build.
- All state is one JSON file encrypted with AES-GCM. The key comes only from the environment. If a required variable is missing, the process exits and prints the variable name, not the value.

## Laws

- Only the process sees an account secret, the encryption key, and the raw bearer. The store keeps the bearer as a hash.
- MCP and the admin UI listen on separate ports. The MCP port serves only `/mcp` and `/health`. The product has no admin login; the operator's outer proxy protects the admin port.
- Model arguments contain no URL, host, or secret. The host comes from connector code or from an account field the operator entered.
- A `proxy` connector's child process gets only the variables its connector maps from account fields, never the gateway environment.
- Admin UI copy, tool names, tool descriptions, and MCP error text are English.
- A new connector is a new OpenSpec change plus code. Do not build a runtime connector catalog.

## Truth

| Layer | Where | When |
| --- | --- | --- |
| Product vision | `mcp-gateway-spec.md` | Source of changes. Not edited during apply |
| Task contract | `openspec/changes/<name>/` | Accepted proposal, delta specs, design, tasks |
| Verification | `openspec/changes/<name>/verification.md` | Written by the validator |
| System behavior | `openspec/specs/` | After archive |

When the vision and the accepted delta disagree, the delta wins for the duration of the change.
