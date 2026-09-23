---
name: code-review
description: Reviews an MCP Gateway change diff against its OpenSpec delta and looks for secret leaks. Use when reviewing a change, a pull request, or a diff before archive. Reports blockers and does not edit the product.
---

# Code review

Review the change diff against the accepted artifacts. A style note is not a blocker.

## Blocker

- A secret, raw bearer, or encryption key appears in an MCP response, an error, the activity log, the admin API, a log line, or a test snapshot that is returned to the client.
- A tool argument carries a URL, a host, or a secret, or the host is taken from model arguments.
- Behavior outside the delta: a route, tool, or connector the change does not specify.
- A delta requirement is unimplemented, or its scenario has no test.
- A test was weakened or removed to make it pass.
- `mcp-gateway-spec.md` or `openspec/specs/` changed during apply.

## Note

Naming, file structure, comment wording. A note does not block archive.

Write the report in the form defined by the validator agent. Do not edit the code.
